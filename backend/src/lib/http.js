class AppError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function createApiError(status, code, message, details = null) {
  return new AppError(status, code, message, details);
}

function sendSuccess(res, data, status = 200, meta = null) {
  res.status(status).json({
    success: true,
    data,
    error: null,
    meta,
  });
}

function asyncHandler(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

module.exports = {
  AppError,
  asyncHandler,
  createApiError,
  sendSuccess,
};
