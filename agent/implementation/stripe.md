# Flownote — Product Flow & Billing Logic

---

## 1. Onboarding Flow

### All Users
1. Download the app (one universal binary)
2. Sign up or log in within the app
3. Land on the app automatically on the **Free tier** — no code prompt, no friction
4. Free tier includes a small token allowance (~¥30 worth) to experience a couple of real sessions

### Upgrade Paths (self-initiated by user)
Once free credits are exhausted, the app shows a prompt to navigate to the **Plan page**.  
Users can also access the Plan page anytime from Settings.

---

## 2. Plan Structure

| Plan | Price | Target | Billing |
|---|---|---|---|
| Free | ¥0 | Anyone trying the app | — |
| Personal Pro | ¥1,500/month | Individual users | Stripe (credit card) |
| Business Team | ¥X × seats/month | Teams & companies | Stripe (credit card) |
| Enterprise | Contact us | Large orgs needing custom contract | Manual invoice |

---

## 3. Personal Pro Plan

- User subscribes via Stripe on the Plan page
- Immediately receives **¥300 worth of tokens** that resets on each billing anniversary
- If tokens run out mid-month, the app shows a "credits exhausted" state — user cannot start a new session until the next billing cycle
- **Mid-session warning** is shown when tokens are running low so users are never cut off abruptly during a meeting
- If user cancels, access and remaining tokens continue until the end of the current billing cycle, then the account reverts to Free

---

## 4. Business Team Plan

### 4a. Admin Setup (New Org)

1. Admin navigates to Plan page → selects **Business Team**
2. Enters the number of seats they want to purchase
3. Pays via Stripe — charged immediately for all seats
4. A unique **activation code** is generated and shown in their dashboard
5. Admin distributes the activation code to their team members

### 4b. Employee Onboarding (Joining an Org)

1. Employee downloads the app and signs up normally (lands on Free tier)
2. Goes to Settings → "Enter team activation code"
3. Enters the code → account is immediately bucketed into the org
4. Employee receives **¥300 worth of tokens per month**, managed and funded by the org admin

### 4c. Token & Member Management (Admin Dashboard)

- Admin can view all members in the org and their individual token usage
- Admin can set a **per-member token limit** (so one heavy user doesn't consume the whole pool)
- Admin can set a **maximum member count** (code becomes invalid once the seat limit is reached)
- If an employee tries to join with a full-seat code, they see: *"Your team's seats are full. Ask your admin to add more seats."*

---

## 5. Seat Changes Mid-Cycle

### Adding Seats
- Admin increases seat count from the dashboard
- **Prorated charge** is applied immediately for the remaining days in the current billing cycle
- The activation code's usage limit increases immediately — new members can join right away

### Removing Seats
- Admin decreases seat count from the dashboard
- Removed member(s) retain access until the **end of the current billing cycle**
- The reduction is reflected from the **next billing cycle**
- No refund is issued for the current cycle

### Cancelling the Entire Plan
- Admin cancels the Business Team plan
- All members retain access until the **end of the current billing cycle**
- On cycle end, all members (including admin) revert to Free tier
- The activation code becomes **invalid** after that date

---

## 6. Enterprise Plan

- Admin clicks "Contact us" on the Plan page
- Handled manually: quote → contract → invoice (bank transfer / 請求書払い)
- Custom seat count, token limits, and onboarding support
- Activation code issued manually after contract is signed

---

## 7. Key Rules Summary

| Scenario | Behavior |
|---|---|
| New signup | Auto Free tier, no code required |
| Free credits exhausted | Block next session, prompt to upgrade |
| Credits exhausted mid-session | Warning shown, session allowed to finish, next session blocked |
| Pro cancellation | Access until cycle end, then Free |
| Seat added mid-cycle | Prorated charge, immediate access |
| Seat removed mid-cycle | Access until cycle end, no refund |
| Team plan cancelled | All members active until cycle end, then Free |
| Code used after seat limit | Blocked with clear message to contact admin |