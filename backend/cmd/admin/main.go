package main

import (
	"context"
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
	case "grant":
		return grant(context.Background(), store, args[1:], stdout, stderr)
	case "revoke":
		return revoke(context.Background(), store, args[1:], stdout, stderr)
	default:
		printUsage(stderr)
		return 2
	}
}

func grant(ctx context.Context, store *access.Store, args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("grant", flag.ContinueOnError)
	flags.SetOutput(stderr)
	userID := flags.String("user", "", "Supabase user id")
	feature := flags.String("feature", "", "screener or backtest")
	untilRaw := flags.String("until", "", "RFC3339 expiry time")
	reason := flags.String("reason", "", "grant reason")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	until, err := time.Parse(time.RFC3339, *untilRaw)
	if err != nil {
		fmt.Fprintln(stderr, "--until must be an RFC3339 timestamp")
		return 2
	}
	if err := store.GrantFeature(ctx, *userID, *feature, until, *reason); err != nil {
		fmt.Fprintln(stderr, "grant failed:", err)
		return 1
	}
	fmt.Fprintf(stdout, "granted %s to %s until %s\n", *feature, *userID, until.UTC().Format(time.RFC3339))
	return 0
}

func revoke(ctx context.Context, store *access.Store, args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("revoke", flag.ContinueOnError)
	flags.SetOutput(stderr)
	userID := flags.String("user", "", "Supabase user id")
	feature := flags.String("feature", "", "screener or backtest")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if err := store.RevokeFeature(ctx, *userID, *feature); err != nil {
		fmt.Fprintln(stderr, "revoke failed:", err)
		return 1
	}
	fmt.Fprintf(stdout, "revoked %s from %s\n", *feature, *userID)
	return 0
}

func printUsage(writer io.Writer) {
	fmt.Fprintln(writer, "usage: signalgen-admin <grant|revoke> [flags]")
}
