const { probeBffReadiness } = require("./dify-bff");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  }
  const readiness = await probeBffReadiness();
  res.setHeader("Cache-Control", "no-store");
  return res.status(readiness.ok ? 200 : 503).json(readiness);
};
