import helmet from "helmet";

export const securityHeaders = helmet({
  contentSecurityPolicy: false,
});
