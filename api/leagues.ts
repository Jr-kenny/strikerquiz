import app from "../src/integrations/app";

export const config = {
  runtime: "nodejs",
};

export default async function handler(request: Request) {
  return app.fetch(request);
}
