const REMOVE_BG_ENDPOINT = "https://api.remove.bg/v1.0/removebg";

const apiKeys = [
  process.env.BG_REMOVE_API_KEY_1,
  process.env.BG_REMOVE_API_KEY_2,
  process.env.BG_REMOVE_API_KEY_3,
  process.env.BG_REMOVE_API_KEY_4,
].filter(Boolean);

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  if (!apiKeys.length) {
    response.status(500).json({ error: "No remove.bg API keys configured." });
    return;
  }

  const { imageUrl } = request.body ?? {};
  if (typeof imageUrl !== "string" || !/^https?:\/\//.test(imageUrl)) {
    response.status(400).json({ error: "A valid imageUrl is required." });
    return;
  }

  console.log(`[remove.bg] received imageUrl: ${imageUrl}`);
  let lastStatus = 500;

  for (const apiKey of apiKeys) {
    const formData = new FormData();
    formData.append("image_url", imageUrl);
    formData.append("size", "auto");
    formData.append("format", "png");

    const removeBgResponse = await fetch(REMOVE_BG_ENDPOINT, {
      method: "POST",
      headers: { "X-Api-Key": apiKey },
      body: formData,
    });

    console.log(`[remove.bg] upstream status: ${removeBgResponse.status}`);

    if (removeBgResponse.ok) {
      const arrayBuffer = await removeBgResponse.arrayBuffer();
      response.setHeader("Content-Type", "image/png");
      response.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
      response.setHeader("X-Remove-Bg-Upstream-Status", String(removeBgResponse.status));
      response.status(200).send(Buffer.from(arrayBuffer));
      return;
    }

    lastStatus = removeBgResponse.status;
  }

  response.status(502).json({ error: "remove.bg failed for all configured keys.", status: lastStatus });
}
