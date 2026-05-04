FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY public ./public
COPY src ./src
#COPY data ./data

ENV PORT=3000
ENV DATA_DIR=/app/data
ENV HELPER_IMAGE=dockerbackup-app

EXPOSE 3000

CMD ["npm", "start"]