FROM node:20-slim

RUN addgroup --system sessionmem && adduser --system --ingroup sessionmem sessionmem

RUN mkdir -p /home/sessionmem/.sessionmem && \
    chown -R sessionmem:sessionmem /home/sessionmem/.sessionmem

RUN npm install -g sessionmem@1.0.5

USER sessionmem

ENV HOME=/home/sessionmem
ENTRYPOINT ["sessionmem"]
