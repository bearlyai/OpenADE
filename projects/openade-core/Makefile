.PHONY: check test check-no-any

check: check-no-any test

check-no-any:
	node ../../scripts/check-no-explicit-any.mjs --self-test .

test:
	go test ./...
