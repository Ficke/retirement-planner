# Build stage
FROM rust:1.91-slim as builder

# Install build dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy manifests
COPY Cargo.toml Cargo.lock ./

# Copy source code
COPY src ./src

# Build for release
RUN cargo build --release

# Runtime stage
FROM debian:bookworm-slim

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the built binary from builder
COPY --from=builder /app/target/release/simulation-server /app/simulation-server

# Set the binary as executable
RUN chmod +x /app/simulation-server

# Expose port (Cloud Run will set PORT env var)
ENV PORT=8081
EXPOSE 8081

# Run the binary
CMD ["/app/simulation-server"]
