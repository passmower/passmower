FROM --platform=$BUILDPLATFORM node:lts AS dev

# define /app as working directory
WORKDIR /app

# copy package.json and package-lock.json to /app
COPY package.json /app
COPY package-lock.json /app
COPY nodemon.json /app

# install node dependencies
RUN npm install

# copy backend code
COPY src/. /app/src/

# copy frontend package.json and package-lock.json
COPY frontend/package.json /app/frontend/
COPY frontend/package-lock.json /app/frontend/

# install adminpage dependencies and code
RUN npm install --prefix frontend
COPY frontend/. /app/frontend/

# copy styles package.json and package-lock.json
COPY styles/package.json /app/styles/
COPY styles/package-lock.json /app/styles/

# install styles dependencies and code
RUN npm install --prefix styles
COPY styles/src/. /app/styles/src/

# launch dev commands
ENTRYPOINT /app/node_modules/.bin/run-p dev*

# production
# build production frontends
FROM --platform=$BUILDPLATFORM dev as build

WORKDIR /app/frontend
RUN npm run build

WORKDIR /app/styles
RUN npm run sass-prod

# production runtime
FROM node:lts-alpine AS prod

WORKDIR /app

# copy package.json and package-lock.json to /app
COPY package.json /app
COPY package-lock.json /app

# install node dependencies
RUN npm install --omit=dev

# copy backend code
COPY src/. /app/src/

# copy compiled frontend
COPY --from=build /app/frontend/dist/. /app/frontend/dist/

# copy compiled styles
COPY --from=build /app/styles/dist/. /app/styles/dist/

# we will not use npm in production as it wants to write on the container filesystem. this should be prohibited on production. however, we need to allow it while developing.
ENV NODE_ENV=production
ENTRYPOINT node --supress-warnings src/app.js
