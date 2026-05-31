.PHONY: all build release install test check clean receiver receiver-install receiver-test worker-install worker-typecheck worker-test bench

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

receiver-install:
	cd $(RECEIVER_DIR) && npm install

receiver-test: receiver-install
	cd $(RECEIVER_DIR) && npm test

test:
	cargo test
	$(MAKE) receiver-test
	$(MAKE) worker-test

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
