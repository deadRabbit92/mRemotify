# syntax=docker/dockerfile:1
#
# Multi-stage build for rdpd — custom RDP daemon using xfreerdp3 + Xvfb.
# Uses Ubuntu 24.04 for both stages since freerdp3-x11 is only in Ubuntu repos.
#

# ---- Build stage ----
FROM ubuntu:24.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    build-essential \
    pkg-config \
    libx11-dev \
    libxcb1-dev \
    libxtst-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Rust toolchain
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
ENV PATH="/root/.cargo/bin:${PATH}"

WORKDIR /app
COPY rdpd/Cargo.toml rdpd/Cargo.lock* ./
COPY rdpd/src ./src

RUN cargo build --release

# ---- Runtime stage ----
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    tigervnc-standalone-server \
    xdotool \
    xclip \
    xsel \
    x11-utils \
    x11-xserver-utils \
    freerdp3-x11 \
    libxcb1 \
    libx11-6 \
    libxtst6 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/rdpd /usr/local/bin/rdpd

ENV RDPD_LISTEN=0.0.0.0:7777
ENV RDPD_LOG_LEVEL=info

EXPOSE 7777

ENTRYPOINT ["/usr/local/bin/rdpd"]
