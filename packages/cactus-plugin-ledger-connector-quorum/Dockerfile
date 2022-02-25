# FROM cactus-api-server:latest

# ARG NPM_PKG_VERSION=latest

# RUN npm i @hyperledger/cactus-plugin-ledger-connector-quorum@${NPM_PKG_VERSION} --production

FROM ghcr.io/hyperledger/cactus-cmd-api-server:2021-08-15--refactor-1222

RUN npm install -g yarn@1.18.0

ENV NODE_ENV=production
ARG NPM_PKG_VERSION=latest

RUN yarn add @hyperledger/cactus-plugin-ledger-connector-quorum@${NPM_PKG_VERSION} --production --ignore-engines