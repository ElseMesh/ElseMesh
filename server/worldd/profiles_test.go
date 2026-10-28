package main

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestWorldProfileDataDirectoriesAreIsolated(t *testing.T) {
	root := t.TempDir()
	first, err := worldProfileDataDir(root, "example-island")
	if err != nil {
		t.Fatal(err)
	}
	second, err := worldProfileDataDir(root, "second-world")
	if err != nil {
		t.Fatal(err)
	}
	if first == second || first != filepath.Join(root, "example-island") || second != filepath.Join(root, "second-world") {
		t.Fatalf("profile data directories are not isolated: %q, %q", first, second)
	}
}

func TestWorldProfileRejectsPathTraversalAndInvalidNames(t *testing.T) {
	for _, profile := range []string{"", "../island", "a/b", "Uppercase", ".hidden", "two words", strings.Repeat("a", 65)} {
		t.Run(profile, func(t *testing.T) {
			if _, err := worldProfileDataDir(t.TempDir(), profile); err == nil {
				t.Fatalf("world profile %q was accepted", profile)
			}
		})
	}
}

func TestListWorldProfilesReturnsOnlySelectableDirectories(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"example-island", "second_world", "Not-A-Profile"} {
		if err := os.Mkdir(filepath.Join(root, name), 0700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(root, "notes.txt"), []byte("ignored"), 0600); err != nil {
		t.Fatal(err)
	}
	profiles, err := listWorldProfilesIn(root)
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"example-island", "second_world"}; !reflect.DeepEqual(profiles, want) {
		t.Fatalf("world profiles = %v; want %v", profiles, want)
	}
}

func TestListWorldProfilesAllowsUninitializedStore(t *testing.T) {
	profiles, err := listWorldProfilesIn(filepath.Join(t.TempDir(), "missing"))
	if err != nil || len(profiles) != 0 {
		t.Fatalf("empty world-profile store = %v, %v; want empty, nil", profiles, err)
	}
}
