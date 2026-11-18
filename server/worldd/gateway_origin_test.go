package main

import "testing"

func TestWorldGatewayOriginAllowlist(t *testing.T) {
	allowed, err := parseAllowedBrowserOrigins([]string{
		"https://game.example",
		"http://127.0.0.1:5189",
	})
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name, origin, host string
		secure, want       bool
	}{
		{name: "non-browser client", host: "127.0.0.1:5222", want: true},
		{name: "same loopback origin", origin: "http://127.0.0.1:5222", host: "127.0.0.1:5222", want: true},
		{name: "explicit local game origin", origin: "http://127.0.0.1:5189", host: "127.0.0.1:5222", want: true},
		{name: "explicit hosted game origin", origin: "https://game.example", host: "world.example", secure: true, want: true},
		{name: "unlisted secure origin", origin: "https://attacker.example", host: "world.example", secure: true, want: false},
		{name: "unlisted local port", origin: "http://127.0.0.1:5190", host: "127.0.0.1:5222", want: false},
		{name: "untrusted public HTTP origin", origin: "http://game.example", host: "world.example", want: false},
		{name: "origin with a path", origin: "https://game.example/path", host: "world.example", secure: true, want: false},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			if got := browserGatewayOriginAllowed(test.origin, test.host, test.secure, allowed); got != test.want {
				t.Fatalf("browserGatewayOriginAllowed(%q, %q, %t) = %t, want %t", test.origin, test.host, test.secure, got, test.want)
			}
		})
	}
}

func TestParseAllowedBrowserOriginsRejectsUnsafeValues(t *testing.T) {
	for _, origin := range []string{
		"http://world.example",
		"https://game.example/path",
		"https://user@game.example",
		"https://game.example?query=1",
	} {
		if _, err := parseAllowedBrowserOrigins([]string{origin}); err == nil {
			t.Errorf("parseAllowedBrowserOrigins accepted unsafe origin %q", origin)
		}
	}
}
