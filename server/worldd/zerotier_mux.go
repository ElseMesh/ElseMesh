package main

import (
	"bufio"
	"net"
)

type bufferedReadConn struct {
	net.Conn
	reader *bufio.Reader
}

func (c bufferedReadConn) Read(buffer []byte) (int, error) {
	return c.reader.Read(buffer)
}

func isWorlddHTTPGatewayRequest(reader *bufio.Reader) (bool, error) {
	for length := 1; length <= 16; length++ {
		prefix, err := reader.Peek(length)
		if err != nil {
			return false, err
		}
		current := prefix[length-1]
		if current == ' ' {
			switch string(prefix[:length-1]) {
			case "GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS":
				return true, nil
			default:
				return false, nil
			}
		}
		if current < 'A' || current > 'Z' {
			return false, nil
		}
	}
	return false, nil
}
