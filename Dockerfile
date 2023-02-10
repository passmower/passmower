FROM node AS dev

# define /app as working directory
WORKDIR /app

# copy package.json and package-lock.json to /app
COPY package.json /app
COPY package-lock.json /app

# install node dependencies
RUN npm install
COPY src/. /app/src/

# launch node server
ENTRYPOINT npm run dev

# production
# we will not use npm in production as it wants to write on the container filesystem. this should be prohibited on production. however, we need to allow it while developing.
FROM dev AS prod
RUN npm install --production
ENTRYPOINT node src/app.js
