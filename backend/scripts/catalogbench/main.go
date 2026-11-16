// catalogbench measures whole-catalog signal-study stages on locally saved
// provider history. It is a local measurement harness, not a server path.
package main

import (
	"flag"
	"fmt"
	"os"
	"time"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: catalogbench fetch|bench [flags]")
		os.Exit(2)
	}
	set := flag.NewFlagSet(os.Args[1], flag.ExitOnError)
	symbols := set.String("symbols", "", "file with one provider symbol per line")
	data := set.String("data", "", "directory of saved daily series")
	delay := set.Duration("delay", 600*time.Millisecond, "pause between provider requests")
	from := set.String("from", "", "study start date (inclusive)")
	to := set.String("to", "", "study end date (inclusive)")
	steps := set.Int("steps", 3, "T+N horizon")
	_ = set.Parse(os.Args[2:])
	var err error
	switch os.Args[1] {
	case "fetch":
		err = fetch(*symbols, *data, *delay)
	case "bench":
		err = bench(*data, *from, *to, *steps)
	default:
		err = fmt.Errorf("unknown command %q", os.Args[1])
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
