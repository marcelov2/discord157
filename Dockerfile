# Usando a imagem do Node.js
FROM node:18

# Definindo o diretório de trabalho
WORKDIR /usr/src/app

# Copiando os arquivos package.json e package-lock.json
COPY package*.json ./

# Instalando as dependências
RUN npm install

# Copiando o restante do código do bot
COPY . .

# Expondo a porta (opcional, se você não estiver usando uma porta específica)
# EXPOSE 3000

# Comando para iniciar o bot
CMD ["node", "index.js"]
