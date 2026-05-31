.PHONY: build test lint fmt dev generate typecheck check

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
