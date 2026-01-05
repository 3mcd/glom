-- Pandoc filter to render mermaid diagrams using Kroki
-- This requires "curl" to be installed on the system.

local function mermaid(block)
  if block.classes[1] == "mermaid" then
    -- Kroki URL format: https://kroki.io/mermaid/svg/
    -- We'll use a POST request to avoid URL length limits for large diagrams
    local success, img = pcall(pandoc.pipe, "curl", {
      "-s",
      "-X", "POST",
      "https://kroki.io/mermaid/svg",
      "--data-binary", "@-"
    }, block.text)
    
    if success and img:sub(1, 4) == "<svg" then
      -- We'll style the SVG in the site's main CSS file (style.css)
      return pandoc.RawBlock("html", '<div class="mermaid-static">' .. img .. '</div>')
    else
      io.stderr:write("Error: Kroki failed to render mermaid diagram\n")
      return block
    end
  end
end

return {{CodeBlock = mermaid}}
