Cost Analysis & Pricing Proposal: CueMe (flownote)
This report provides an estimate of the operational costs for CueMe based on its current technical architecture and proposes a competitive pricing strategy in JPY.

1. Cost Breakdown (Per 60-Minute Session)
Based on the current architecture using OpenAI Realtime API for continuous listening and Google Gemini 2.0 Flash for response generation.

Component	Provider	Model	Est. Usage (1hr)	Cost (USD)	Cost (JPY)
Transcription	OpenAI	Realtime (Audio In)	600k tokens	$6.00	¥960
Question Detection	OpenAI	Realtime (Text Out)	12k tokens	$0.03	¥5
Response AI	Google	Gemini 2.0 Flash	80k tokens	$0.01	¥2
RAG/Embeddings	OpenAI	text-embedding-3	20k tokens	$0.003	¥0.5
Total (per hr)				~$6.04	~¥967
WARNING

Cost Criticality: Using the "Full" gpt-4o-realtime-preview model instead of mini increases the hourly cost to ~$20.00 (¥3,200). The current architecture makes high-volume transcription very expensive.

2. Competitor Benchmarking (JPY)
Feature	Notta (Premium)	Fireflies (Pro)	CueMe (Target)
Monthly Price	¥1,980	~$2,900 ($18)	¥2,980
Annual Price	¥1,185/mo	~$1,600 ($10)/mo	¥1,980/mo
Included Minutes	1,800 min	Unlimited (Meeting)	1,200 min
AI Features	Summary/Templates	Ask AI (30 credits)	Unlimited AI Mentoring
3. Proposed Pricing Strategy (JPY)
To be profitable while remaining competitive, we recommend three tiers.

Tier 1: Free (Starter)
Price: ¥0
Transcription Plan: 30 minutes total (one-time)
AI Responses: 5 responses total
Purpose: Acquisition and technical validation.
Tier 2: Pro (Standard)
Price (Monthly): ¥2,980
Price (Annual): ¥1,980 / mo (¥23,760 / yr)
Usage Limits:
1,200 minutes (20 hours) transcription per month.
Unlimited AI Responses (Gemini-powered).
Max duration per session: 90 minutes.
Architectural Condition: Requires switching to "Low Latency" mode (Whisper/Deepgram) for general transcription.
Tier 3: Elite (Career Prep)
Price (Monthly): ¥7,800
Price (Annual): ¥4,900 / mo (¥58,800 / yr)
Usage Limits:
3,000 minutes (50 hours) transcription per month.
Priority "Ultra Low Latency" (Full OpenAI Realtime) allowed for up to 5 hours/mo.
Full RAG Knowledge Base: Up to 100 documents.
4. Architectural Recommendations for Profitability
To achieve the "Pro" tier pricing effectively, we suggest the following optimizations:

Hybrid Transcription:
Standard Mode: Use OpenAI Whisper or Deepgram Nova-3. Cost drops from ¥960/hr to ¥60/hr.
Elite Mode: Keep OpenAI Realtime for users who need <200ms latency, but charge a significant premium or limit minutes.
Question Detection Optimization:
Instead of letting the Realtime model "detect" questions, send the low-cost Whisper transcript to Gemini 2.0 Flash every 5-10 seconds. Gemini 2.0 Flash is 100x cheaper for this task.
Token Caching:
Heavily utilize OpenAI Prompt Caching for the "Context" (user documents) during Realtime sessions to reduce cost by 50-90% for repeated input.
5. Summary Table (Monthly Plan)
Tier	Monthly JPY	Annual JPY/mo	Minutes	Key Feature
Free	¥0	¥0	30	5 AI Responses
Pro	¥2,980	¥1,980	1,200	Unlimited AI Assist
Elite	¥7,800	¥4,900	3,000	Ultra Low Latency
Assumptions: Exchange rate 1 USD = 159 JPY.