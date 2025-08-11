# Use Node.js LTS image
FROM node:18

# Create app directory
WORKDIR /usr/src/app

# Copy files
COPY package*.json ./
COPY server.js ./

# Install dependencies
RUN npm install

# Expose port
EXPOSE 3000

# Start the server
CMD ["npm", "start"]