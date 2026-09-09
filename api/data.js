// Serves the deep-indexed PSC / KPI dataset (auth required)
const { requireAuth } = require("./_auth");
const data = require("../data/index.json");

module.exports = async (req, res) => {
  if (!requireAuth(req, res)) return;
  res.setHeader("Cache-Control", "private, max-age=600");
  res.status(200).json(data);
};
