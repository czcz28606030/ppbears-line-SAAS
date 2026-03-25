FROM node:20-slim AS builder
WORKDIR /app

COPY package.json tsconfig.json ./
COPY packages/backend/package.json packages/backend/tsconfig.json ./packages/backend/
RUN npm install --workspace=packages/backend

COPY packages/backend/src ./packages/backend/src
RUN npm run build -w packages/backend

FROM node:20-slim
WORKDIR /app

COPY --from=builder /app/packages/backend/dist ./dist
COPY --from=builder /app/packages/backend/package.json ./
COPY --from=builder /app/node_modules ./node_modules

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/app.js"]
