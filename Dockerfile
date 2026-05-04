FROM node:20-bookworm-slim

ARG REPO_URL=https://github.com/asabino2/dockerbackup.git
ARG REPO_REF=main

WORKDIR /app

RUN apt-get update \
	&& apt-get install -y --no-install-recommends git ca-certificates \
	&& rm -rf /var/lib/apt/lists/* \
	&& git clone --depth 1 --branch ${REPO_REF} ${REPO_URL} /app \
	&& npm ci --omit=dev \
	&& mkdir -p /app/data

ENV PORT=3000
ENV DATA_DIR=/app/data
ENV HELPER_IMAGE=dockerbackup-app

EXPOSE 3000

CMD ["npm", "start"]