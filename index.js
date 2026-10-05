const express = require('express');
const indexRouter = require('./routes/index');

const app = express();
const port = 3001;

app.use(express.json());

app.use(indexRouter);

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
