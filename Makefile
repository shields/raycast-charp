.PHONY: build test native-test coverage lint fmt dev generate leipzig icon typecheck check

build: generate
	npm run build

test: generate
	npx vitest run

native-test:
	swift test --package-path swift

coverage: generate
	npx vitest run --coverage

typecheck: generate
	npx tsc -p tsconfig.json --noEmit

check: generate lint typecheck coverage native-test

lint: actions-lock-verify-local
	npx ray lint
	npx prettier --check .

fmt:
	npx prettier --write .

dev:
	npm run dev

generate:
	npx tsx scripts/generate-data.ts

# Refresh src/leipzig-freq.json from the Leipzig corpora (~0.5GB download).
# Run occasionally; `generate` consumes the committed result.
leipzig:
	npx tsx scripts/compute-leipzig-freq.ts

icon:
	npx tsx scripts/generate-icon.ts

.PHONY: actions-lock-install actions-lock actions-lock-verify-local actions-lock-verify

actions-lock-install:
	gh extension install github/gh-actions-lock --pin v0.4.1 --force

actions-lock:
	gh actions-lock --no-interactive

actions-lock-verify-local:
	gh actions-lock --verify-local

actions-lock-verify:
	gh actions-lock --verify
