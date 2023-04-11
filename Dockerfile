FROM --platform=$BUILDPLATFORM node:lts AS dev

# define /app as working directory
WORKDIR /app

# copy package.json and package-lock.json to /app
COPY package.json /app
COPY package-lock.json /app

# install node dependencies
RUN npm install

# copy backend code
COPY src/. /app/src/

# copy frontpage package.json and package-lock.json
COPY frontpage/package.json /app/frontpage/
COPY frontpage/package-lock.json /app/frontpage/

# install frontpage dependencies
RUN npm install --prefix frontpage
COPY frontpage/. /app/frontpage/

# copy frontpage package.json and package-lock.json
COPY styles/package.json /app/styles/
COPY styles/package-lock.json /app/styles/

# install frontpage dependencies
RUN npm install --prefix styles
COPY styles/src/. /app/styles/src/

# launch dev commands
ENTRYPOINT /app/node_modules/.bin/run-p dev*

# production
# build production frontends
FROM --platform=$BUILDPLATFORM dev as build

WORKDIR /app/frontpage
RUN npm run build

WORKDIR /app/styles
RUN npm run sass-prod

# production runtime
# we will not use npm in production as it wants to write on the container filesystem. this should be prohibited on production. however, we need to allow it while developing.
FROM node:lts-alpine AS prod

WORKDIR /app

# copy package.json and package-lock.json to /app
COPY package.json /app
COPY package-lock.json /app

# install node dependencies
RUN npm install --omit=dev

# copy backend code
COPY src/. /app/src/

# copy compiled frontpage
COPY --from=build /app/frontpage/dist/. /app/frontpage/dist/

# copy compiled styles
COPY --from=build /app/styles/dist/. /app/styles/dist/

ENTRYPOINT node src/app.js
