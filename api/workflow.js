const { handleWorkflowBody } = require("./dify-bff");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  }

  const response = await handleWorkflowBody(req.body);
  return res.status(response.status).json(response.payload);
};
