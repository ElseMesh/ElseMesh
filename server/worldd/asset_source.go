package main

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

const assetSourceConfigName = "asset-source.path"

func verifyWorldPackageAssets(packageAssetsDir string, manifest worldManifest) (int, int64, error) {
	info, err := os.Stat(packageAssetsDir)
	if err != nil {
		return 0, 0, err
	}
	if !info.IsDir() {
		return 0, 0, errors.New("world asset source must be a directory")
	}
	if len(manifest.Assets) > 10000 {
		return 0, 0, errors.New("world package contains too many assets")
	}
	var totalBytes int64
	seen := make(map[string]struct{}, len(manifest.Assets))
	for _, asset := range manifest.Assets {
		if !assetIDPattern.MatchString(asset.ID) || asset.Bytes < 0 || asset.Bytes > maxAssetBytes {
			return 0, 0, fmt.Errorf("invalid package asset %q", asset.ID)
		}
		if _, duplicate := seen[asset.ID]; duplicate {
			return 0, 0, fmt.Errorf("duplicate package asset %q", asset.ID)
		}
		seen[asset.ID] = struct{}{}
		if asset.Bytes > maxImportPackageBytes-totalBytes {
			return 0, 0, errors.New("world package exceeds the 16 GiB package limit")
		}
		totalBytes += asset.Bytes
		if manifest.Rules.MaxPackageBytes != nil && totalBytes > *manifest.Rules.MaxPackageBytes {
			return 0, 0, errors.New("world package exceeds its signed byte budget")
		}
		path := filepath.Join(packageAssetsDir, strings.TrimPrefix(asset.ID, "sha256:"))
		fileInfo, err := os.Lstat(path)
		if err != nil {
			return 0, 0, fmt.Errorf("package asset %s: %w", asset.ID, err)
		}
		if !fileInfo.Mode().IsRegular() || fileInfo.Size() != asset.Bytes {
			return 0, 0, fmt.Errorf("package asset %s has an invalid file type or size", asset.ID)
		}
		file, err := os.Open(path)
		if err != nil {
			return 0, 0, err
		}
		opened, statErr := file.Stat()
		if statErr != nil || !os.SameFile(fileInfo, opened) {
			_ = file.Close()
			return 0, 0, fmt.Errorf("package asset %s changed while opening", asset.ID)
		}
		actualID, hashErr := hashFile(io.LimitReader(file, asset.Bytes+1))
		closeErr := file.Close()
		if hashErr != nil {
			return 0, 0, fmt.Errorf("verify package asset %s: %w", asset.ID, hashErr)
		}
		if closeErr != nil {
			return 0, 0, closeErr
		}
		if actualID != asset.ID {
			return 0, 0, fmt.Errorf("package asset %s does not match its content hash", asset.ID)
		}
	}
	return len(manifest.Assets), totalBytes, nil
}

func readAssetSourceConfig(dataDir string) (string, error) {
	path := filepath.Join(dataDir, assetSourceConfigName)
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 || info.Size() > 4096 {
		return "", errors.New("asset source configuration must be a private regular file")
	}
	contents, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	value := strings.TrimSpace(string(contents))
	if value == "" || strings.ContainsAny(value, "\r\n") || !filepath.IsAbs(value) {
		return "", errors.New("asset source configuration must contain one absolute directory path")
	}
	return value, nil
}

func writeAssetSourceConfig(dataDir, assetSourceDir string) error {
	if assetSourceDir == "" {
		return nil
	}
	absolute, err := filepath.Abs(assetSourceDir)
	if err != nil {
		return err
	}
	info, err := os.Stat(absolute)
	if err != nil {
		return err
	}
	if !info.IsDir() || strings.ContainsAny(absolute, "\r\n") {
		return errors.New("asset source must be an absolute directory path")
	}
	if err := os.MkdirAll(dataDir, 0700); err != nil {
		return err
	}
	temp, err := os.CreateTemp(dataDir, ".asset-source-*.tmp")
	if err != nil {
		return err
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)
	if err := temp.Chmod(0600); err != nil {
		_ = temp.Close()
		return err
	}
	if _, err := fmt.Fprintln(temp, absolute); err != nil {
		_ = temp.Close()
		return err
	}
	if err := temp.Sync(); err != nil {
		_ = temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	return os.Rename(tempPath, filepath.Join(dataDir, assetSourceConfigName))
}
