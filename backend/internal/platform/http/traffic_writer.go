package http

import (
	"bufio"
	"net"
	stdhttp "net/http"
)

// trafficWriter counts HTTP output without buffering or modifying its body.
// Unwrap preserves ResponseController deadlines and other transport capabilities.
type trafficWriter struct {
	stdhttp.ResponseWriter
	status int
	bytes  int64
}

func (writer *trafficWriter) Unwrap() stdhttp.ResponseWriter { return writer.ResponseWriter }

func (writer *trafficWriter) WriteHeader(status int) {
	if writer.status != 0 {
		return
	}
	// 100 Continue / 103 Early Hints are not the final response status.
	if status >= 200 || status == stdhttp.StatusSwitchingProtocols {
		writer.status = status
	}
	writer.ResponseWriter.WriteHeader(status)
}

func (writer *trafficWriter) Write(raw []byte) (int, error) {
	if writer.status == 0 {
		writer.WriteHeader(stdhttp.StatusOK)
	}
	written, err := writer.ResponseWriter.Write(raw)
	writer.bytes += int64(written)
	return written, err
}

func (writer *trafficWriter) FlushError() error {
	if writer.status == 0 {
		writer.WriteHeader(stdhttp.StatusOK)
	}
	return stdhttp.NewResponseController(writer.ResponseWriter).Flush()
}

func (writer *trafficWriter) Flush() { _ = writer.FlushError() }

// coder/websocket writes its handshake through a hijacked connection. Record
// 101 only on successful hijacking; never wrap or buffer the returned socket.
func (writer *trafficWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	connection, buffered, err := stdhttp.NewResponseController(writer.ResponseWriter).Hijack()
	if err == nil {
		writer.status = stdhttp.StatusSwitchingProtocols
	}
	return connection, buffered, err
}
