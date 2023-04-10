FROM node:lts AS dev

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
# we will not use npm in production as it wants to write on the container filesystem. this should be prohibited on production. however, we need to allow it while developing.
FROM dev AS prod
RUN npm install --production

WORKDIR /app/frontpage
RUN npm run build

WORKDIR /app/styles
RUN npm run sass-prod

WORKDIR /app
ENTRYPOINT node src/app.js
