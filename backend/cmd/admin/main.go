package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"flag"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
)

func main() {
	os.Exit(run(os.Args[1:], os.Getenv, os.Stdout, os.Stderr))
}

func run(args []string, getenv func(string) string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		printUsage(stderr)
		return 2
	}
	databasePath := getenv("SIGNALGEN_GO_DB_PATH")
	if databasePath == "" {
		fmt.Fprintln(stderr, "SIGNALGEN_GO_DB_PATH is required")
		return 2
	}
	store, err := access.OpenSQLite(databasePath)
	if err != nil {
		fmt.Fprintln(stderr, "open access storage:", err)
		return 1
	}
	defer store.Close()

	switch args[0] {
	case "bootstrap-operator":
		return bootstrapOperator(context.Background(), store, args[1:], stdout, stderr)
	case "grant":
		return grant(context.Background(), store, args[1:], stdout, stderr)
	case "revoke":
		return revoke(context.Background(), store, args[1:], stdout, stderr)
	default:
		printUsage(stderr)
		return 2
	}
}

func bootstrapOperator(ctx context.Context, store *access.Store, args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("bootstrap-operator", flag.ContinueOnError)
	flags.SetOutput(stderr)
	userID := flags.String("user", "", "existing Supabase user id")
	reason := flags.String("reason", "", "bootstrap reason")
	actor := flags.String("actor", "", "local administrator identifier recorded in audit")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	requestID, err := newCLIRequestID()
	if err != nil {
		fmt.Fprintln(stderr, "create audit request id:", err)
		return 1
	}
	if err := store.BootstrapOperator(ctx, *actor, requestID, *userID, *reason); err != nil {
		fmt.Fprintln(stderr, "operator bootstrap failed:", err)
		return 1
	}
	fmt.Fprintf(stdout, "bootstrapped operator %s (audit %s)\n", *userID, requestID)
	return 0
}

func grant(ctx context.Context, store *access.Store, args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("grant", flag.ContinueOnError)
	flags.SetOutput(stderr)
	userID := flags.String("user", "", "Supabase user id")
	feature := flags.String("feature", "", "screener or backtest")
	untilRaw := flags.String("until", "", "RFC3339 expiry time")
	reason := flags.String("reason", "", "grant reason")
	actor := flags.String("actor", "", "operator identifier recorded in audit")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	until, err := time.Parse(time.RFC3339, *untilRaw)
	if err != nil {
		fmt.Fprintln(stderr, "--until must be an RFC3339 timestamp")
		return 2
	}
	requestID, err := newCLIRequestID()
	if err != nil {
		fmt.Fprintln(stderr, "create audit request id:", err)
		return 1
	}
	if _, err := store.GrantFeatureAudited(ctx, *actor, requestID, *userID, *feature, until, *reason); err != nil {
		fmt.Fprintln(stderr, "grant failed:", err)
		return 1
	}
	fmt.Fprintf(stdout, "granted %s to %s until %s (audit %s)\n", *feature, *userID, until.UTC().Format(time.RFC3339), requestID)
	return 0
}

func revoke(ctx context.Context, store *access.Store, args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("revoke", flag.ContinueOnError)
	flags.SetOutput(stderr)
	userID := flags.String("user", "", "Supabase user id")
	feature := flags.String("feature", "", "screener or backtest")
	reason := flags.String("reason", "", "revoke reason")
	actor := flags.String("actor", "", "operator identifier recorded in audit")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	requestID, err := newCLIRequestID()
	if err != nil {
		fmt.Fprintln(stderr, "create audit request id:", err)
		return 1
	}
	if err := store.RevokeFeatureAudited(ctx, *actor, requestID, *userID, *feature, *reason); err != nil {
		fmt.Fprintln(stderr, "revoke failed:", err)
		return 1
	}
	fmt.Fprintf(stdout, "revoked %s from %s (audit %s)\n", *feature, *userID, requestID)
	return 0
}

func newCLIRequestID() (string, error) {
	raw := make([]byte, 12)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return "cli_" + hex.EncodeToString(raw), nil
}

func printUsage(writer io.Writer) {
	fmt.Fprintln(writer, "usage: signalgen-admin <bootstrap-operator|grant|revoke> [flags]")
}
