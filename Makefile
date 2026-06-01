.PHONY: build test lint fmt dev generate leipzig icon typecheck check

build: generate
	npm run build

test: generate
	npx vitest run

typecheck: generate
	npx tsc -p tsconfig.json --noEmit

check: generate lint typecheck test

lint:
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
