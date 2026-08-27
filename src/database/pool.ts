import mysql from "mysql2/promise";
import { config, MYSQL_TIME_ZONE } from "../config.js";

export const pool = mysql.createPool({
  host: config.DB_HOST,
  port: config.DB_PORT,
  user: config.DB_USER,
  password: config.DB_PASSWORD,
  database: config.DB_NAME,
  connectionLimit: config.DB_POOL_SIZE,
  timezone: MYSQL_TIME_ZONE,
  decimalNumbers: true,
  namedPlaceholders: true
});

pool.on("connection", (connection) => { connection.query(`SET time_zone = '${MYSQL_TIME_ZONE}'`); });
