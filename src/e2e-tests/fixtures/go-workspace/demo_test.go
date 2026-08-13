package demo

import (
	"runtime"
	"testing"
)

// Fails when built with any toolchain other than the one mise.toml pins
func TestToolchainVersion(t *testing.T) {
	if runtime.Version() != "go1.25.0" {
		t.Fatalf("built with %s, mise.toml pins go1.25.0", runtime.Version())
	}
}
