import logging
from typing import Callable, Optional

from .research_agents import build_reader_agent, build_search_agent, writer_chain, critic_chain

logger = logging.getLogger(__name__)


def _message_text(content) -> str:
    # Gemini responses from langchain's agent runtime can return content as
    # a list of content-part dicts (e.g. [{"type": "text", "text": "..."}])
    # instead of a plain string — normalize either shape to str so it's
    # safe to persist in a Text column.
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = [
            part if isinstance(part, str) else part.get("text", "")
            for part in content
            if isinstance(part, str) or (isinstance(part, dict) and part.get("type") == "text")
        ]
        return "\n".join(p for p in parts if p)
    return str(content)


def run_research_pipeline(topic: str) -> dict:
    return run_research_pipeline_with_callback(topic)


def run_research_pipeline_with_callback(
    topic: str,
    on_step_start: Optional[Callable[[str], None]] = None,
    on_step_complete: Optional[Callable[[str, dict], None]] = None,
) -> dict:
    on_step_start = on_step_start or (lambda step: None)
    on_step_complete = on_step_complete or (lambda step, result: None)

    state = {}

    # step 1 - search agent
    on_step_start("search")
    logger.info("step 1 - search agent is working on topic=%r", topic)
    search_agent = build_search_agent()
    search_result = search_agent.invoke({
        "messages": [("user", f"Find recent, reliable and detailed information about: {topic}")]
    })
    state["search_results"] = _message_text(search_result["messages"][-1].content)
    on_step_complete("search", {"search_results": state["search_results"]})

    # step 2 - reader agent
    on_step_start("reader")
    logger.info("step 2 - reader agent is scraping top resources")
    reader_agent = build_reader_agent()
    reader_result = reader_agent.invoke({
        "messages": [("user",
            f"Based on the following search results about '{topic}', "
            f"pick the most relevant URL and scrape it for deeper content.\n\n"
            f"Search Results:\n{state['search_results'][:800]}"
        )]
    })
    state["scraped_content"] = _message_text(reader_result["messages"][-1].content)
    on_step_complete("reader", {"scraped_content": state["scraped_content"]})

    # step 3 - writer chain
    on_step_start("writer")
    logger.info("step 3 - writer is drafting the report")
    research_combined = (
        f"SEARCH RESULTS:\n{state['search_results']}\n\n"
        f"DETAILED SCRAPED CONTENT:\n{state['scraped_content']}"
    )
    state["report"] = writer_chain.invoke({
        "topic": topic,
        "research": research_combined,
    })
    on_step_complete("writer", {"report": state["report"]})

    # step 4 - critic chain
    on_step_start("critic")
    logger.info("step 4 - critic is reviewing the report")
    state["feedback"] = critic_chain.invoke({
        "report": state["report"],
    })
    on_step_complete("critic", {"feedback": state["feedback"]})

    return state


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    topic = input("\n Enter a research topic : ")
    result = run_research_pipeline(topic)
    print("\nFinal Report\n", result["report"])
    print("\nCritic report\n", result["feedback"])
