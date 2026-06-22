.PHONY: check test check-contracts check-no-any

check: check-contracts check-no-any test

check-contracts:
	cd ../openade-client && npm run check:contracts

check-no-any:
	node ../../scripts/check-no-explicit-any.mjs --self-test .

test:
	go test ./...
