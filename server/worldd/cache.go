package main

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/libp2p/go-libp2p/core/peer"
)

const cacheChunkBytes = int64(192 << 10)

type assetFileStamp struct {
	size    int64
	modTime int64
}

func (d *daemon) syncCacheLoop(sources []peer.ID, interval time.Duration) {
	for {
		for _, source := range sources {
			if d.ctx.Err() != nil {
				return
			}
			if err := d.syncCacheFrom(d.ctx, source); err != nil && d.ctx.Err() == nil {
				log.Printf("content cache sync from %s failed: %v", source, err)
			}
		}
		timer := time.NewTimer(interval)
		select {
		case <-d.ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}

func (d *daemon) syncCacheFrom(ctx context.Context, source peer.ID) error {
	if !d.canServeAssets(time.Now()) {
		return errors.New("content-cache grant is not active")
	}
	if source == d.host.ID() {
		return errors.New("cache source is this node")
	}
	response, err := d.gatewayRequest(ctx, gatewayMessage{Type: "manifest.get", WorldID: d.world.WorldID, TargetPeerID: source.String(), RequestID: "cache-manifest"})
	if err != nil {
		return err
	}
	if response.Type != "manifest" || response.Document == nil {
		return errors.New("cache source returned no signed manifest")
	}
	remoteWorld, err := decodeManifest(*response.Document, d.host.ID().String(), time.Now())
	if err != nil {
		return fmt.Errorf("cache source manifest: %w", err)
	}
	if remoteWorld.WorldID != d.world.WorldID || remoteWorld.OwnerPeerID != d.world.OwnerPeerID {
		return errors.New("cache source belongs to another world owner")
	}
	remoteAssets := make(map[string]assetRef, len(remoteWorld.Assets))
	for _, asset := range remoteWorld.Assets {
		remoteAssets[asset.ID] = asset
	}
	for _, asset := range d.world.Assets {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if d.hasVerifiedAsset(asset) {
			continue
		}
		remoteAsset, ok := remoteAssets[asset.ID]
		if !ok || remoteAsset.Bytes != asset.Bytes {
			return fmt.Errorf("cache source does not serve manifest asset %s", asset.ID)
		}
		if err := d.syncAssetFrom(ctx, source, asset); err != nil {
			return fmt.Errorf("cache asset %s: %w", asset.ID, err)
		}
		log.Printf("cached world=%s asset=%s bytes=%d source=%s", d.world.WorldID, asset.ID, asset.Bytes, source)
	}
	if err := d.syncRoleRevocationsFrom(ctx, source.String()); err != nil {
		return fmt.Errorf("cache role revocation state: %w", err)
	}
	return nil
}

func (d *daemon) syncAssetFrom(ctx context.Context, source peer.ID, asset assetRef) error {
	temp, err := os.CreateTemp(d.assetsDir, ".cache-sync-*")
	if err != nil {
		return err
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)
	hasher := sha256.New()
	writer := io.MultiWriter(temp, hasher)
	var written int64
	for offset := int64(0); offset < asset.Bytes; offset += cacheChunkBytes {
		length := min(cacheChunkBytes, asset.Bytes-offset)
		request := gatewayMessage{
			Type: "asset.get", WorldID: d.world.WorldID, AssetID: asset.ID,
			TargetPeerID: source.String(), RequestID: fmt.Sprintf("cache-%s-%d", strings.TrimPrefix(asset.ID, "sha256:"), offset),
			Offset: offset, Length: length,
		}
		response, err := d.gatewayRequest(ctx, request)
		if err != nil {
			temp.Close()
			return err
		}
		if response.Type != "asset.chunk" || response.AssetID != asset.ID || response.Offset != offset || response.Total != asset.Bytes {
			temp.Close()
			return errors.New("cache source returned an unexpected chunk")
		}
		chunk, err := base64.RawStdEncoding.DecodeString(response.Chunk)
		if err != nil || int64(len(chunk)) != length {
			temp.Close()
			return errors.New("cache source returned malformed chunk data")
		}
		n, err := writer.Write(chunk)
		if err != nil {
			temp.Close()
			return err
		}
		if n != len(chunk) {
			temp.Close()
			return io.ErrShortWrite
		}
		written += int64(n)
	}
	actualID := "sha256:" + hex.EncodeToString(hasher.Sum(nil))
	if written != asset.Bytes || actualID != asset.ID {
		temp.Close()
		return errors.New("cached asset failed its declared size or SHA-256")
	}
	if err := temp.Sync(); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tempPath, d.assetPath(asset.ID)); err != nil {
		return err
	}
	d.rememberVerifiedAsset(asset)
	return nil
}

func (d *daemon) hasVerifiedAsset(asset assetRef) bool {
	file, err := os.Open(d.assetPath(asset.ID))
	if err != nil {
		return false
	}
	defer file.Close()
	return d.verifyAssetFile(asset, file)
}

func (d *daemon) verifyAssetFile(asset assetRef, file *os.File) bool {
	d.assetCheckMu.Lock()
	if d.assetVerificationLocks == nil {
		d.assetVerificationLocks = make(map[string]*sync.Mutex)
	}
	verificationLock := d.assetVerificationLocks[asset.ID]
	if verificationLock == nil {
		verificationLock = &sync.Mutex{}
		d.assetVerificationLocks[asset.ID] = verificationLock
	}
	d.assetCheckMu.Unlock()
	verificationLock.Lock()
	defer verificationLock.Unlock()

	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() != asset.Bytes {
		return false
	}
	stamp := assetFileStamp{size: info.Size(), modTime: info.ModTime().UnixNano()}
	d.assetCheckMu.Lock()
	verified, ok := d.verifiedAssets[asset.ID]
	d.assetCheckMu.Unlock()
	if ok && verified == stamp {
		return true
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return false
	}
	actual, err := hashFile(file)
	if err != nil || actual != asset.ID {
		return false
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return false
	}
	d.assetCheckMu.Lock()
	if d.verifiedAssets == nil {
		d.verifiedAssets = make(map[string]assetFileStamp)
	}
	d.verifiedAssets[asset.ID] = stamp
	d.assetCheckMu.Unlock()
	return true
}

func (d *daemon) rememberVerifiedAsset(asset assetRef) {
	info, err := os.Stat(d.assetPath(asset.ID))
	if err != nil || !info.Mode().IsRegular() || info.Size() != asset.Bytes {
		return
	}
	d.assetCheckMu.Lock()
	if d.verifiedAssets == nil {
		d.verifiedAssets = make(map[string]assetFileStamp)
	}
	d.verifiedAssets[asset.ID] = assetFileStamp{size: info.Size(), modTime: info.ModTime().UnixNano()}
	d.assetCheckMu.Unlock()
}

func (d *daemon) assetPath(id string) string {
	return filepath.Join(d.assetsDir, strings.TrimPrefix(id, "sha256:"))
}
