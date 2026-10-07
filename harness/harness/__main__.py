"""`python -m harness …` entry point — delegates to cli.main()."""

from harness.cli import main

if __name__ == "__main__":
    raise SystemExit(main())
