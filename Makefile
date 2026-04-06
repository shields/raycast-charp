.PHONY: build test lint fmt dev generate

build: generate
	npm run build

test:
	npx vitest run

lint:
	npx ray lint
	npx prettier --check .

fmt:
	npx prettier --write .

dev:
	npm run dev

generate:
	npx tsx scripts/generate-data.ts
