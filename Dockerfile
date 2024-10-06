# Use a imagem base do Node.js
FROM node:16

# Define o diretório de trabalho
WORKDIR /usr/src/app

# Copia os arquivos package.json e package-lock.json
COPY package*.json ./

# Instala as dependências
RUN npm install

# Copia o restante dos arquivos
COPY . .

# Expõe a porta que o servidor irá usar
EXPOSE 3000

# Comando para iniciar o servidor
CMD ["node", "index.js"]
