.PHONY: all build release install test check clean receiver worker-install worker-typecheck worker-test bench

RECEIVER_DIR := assets/receiver
CLI_CRATE := crates/drop2-cli
WORKER_DIR := worker

all: build

receiver:
	cd $(RECEIVER_DIR) && npm install && npm run build

build: receiver
	cargo build

release: receiver
	cargo build --release

install: release
	cargo install --path $(CLI_CRATE) --force

test:
	cargo test
	cd $(RECEIVER_DIR) && npm test
	cd $(WORKER_DIR) && npm test

check: test worker-typecheck

worker-install:
	cd $(WORKER_DIR) && npm install

worker-typecheck: worker-install
	cd $(WORKER_DIR) && npm run typecheck

worker-test: worker-install
	cd $(WORKER_DIR) && npm test

bench:
	node scripts/bench/run.mjs

clean:
	cargo clean
