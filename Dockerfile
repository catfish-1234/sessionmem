FROM node:20-slim

# Create the data directory sessionmem uses for local SQLite storage
RUN mkdir -p /root/.sessionmem

# Install sessionmem globally from npm
RUN npm install -g sessionmem

# Start the MCP server via stdio
ENTRYPOINT ["sessionmem"]
