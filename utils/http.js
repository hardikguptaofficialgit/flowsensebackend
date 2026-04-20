export function sendJsonError(res, status, error, details) {
  const allowDetails = process.env.NODE_ENV !== "production" && String(process.env.EXPOSE_ERROR_DETAILS || "").toLowerCase() === "true";
  res.status(status).json({
    error,
    ...(allowDetails && details ? { details } : {}),
  });
}
