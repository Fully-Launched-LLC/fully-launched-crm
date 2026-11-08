# SOW boilerplate (verbatim)

Fixed legal text for the CRM Master SOW Google Doc. `scripts/build-doc-templates.ts` reads this file once to write the master; after that the master in Google Docs is the only source (edit it there, not here).

Each section is `## key`, then a meta line, then the body exactly as it goes into the Doc. `{{tokens}}` are filled by code at generation. Lines starting with `- ` are bullets.

## supersedes_clause
<!-- branch: all -->

This Statement of Work is entered into between Fully Launched and {{client_name}}. It supersedes the pricing and scope described in any preliminary proposal or discussion previously provided to {{client_name}}. Where this SOW and that document differ, this SOW governs.

## overview_multi
<!-- branch: all -->

Fully Launched will manage {{client_name}}'s digital launch as a single coordinated engagement across {{workstreams}}. Each workstream is priced independently and may be selected or declined by {{client_name}} at signature. Selections are recorded in Section {{selection_section_number}} of this document.

## overview_single
<!-- branch: all -->

Fully Launched will deliver {{workstreams}} for {{client_name}} as described in this Statement of Work.

## website_maintenance
<!-- branch: website -->

Monthly maintenance fee: {{maintenance_amount}}. Covers {{maintenance_covers}}. Maintenance is optional, billed monthly in arrears, and may be cancelled at any time.

## marketplace_post_launch
<!-- branch: marketplace -->

{{optimization_period}} of included optimization following launch. Thereafter, ongoing support is available on retainer at {{retainer_amount}}/month, covering approximately {{retainer_hours}} hours monthly of {{retainer_covers}}. Work exceeding retainer hours is billed at {{overage_rate}}/hour with prior written approval.

## social_travel_terms
<!-- branch: social -->

Travel is not included in the monthly fee and is reimbursed separately as a line item on the monthly invoice. Reimbursable travel consists of the following:
- Mileage, reimbursed at the prevailing IRS standard mileage rate
- Lodging, where an overnight stay is required
- Meals and incidentals at a standard per diem

## social_production_day_terms
<!-- branch: social -->

- Production days are scheduled with a minimum of {{production_notice_days}} days' advance notice
- {{client_name}} provides the location, product samples/materials, wardrobe, and any required talent
- Fully Launched supplies the shot list in advance. Plan for {{production_setups}} distinct setups per production day
- A production day cancelled within {{production_cancel_hours}} hours of the scheduled date is considered delivered for that month and is not rescheduled at no charge
- Additional production days beyond those included are available by written amendment

## exclusions_website
<!-- branch: website -->

- Domain registration, platform subscription fees, and third-party app costs, billed directly to client

## exclusions_marketplace
<!-- branch: marketplace -->

- Additional marketplaces not named above, available by written amendment
- Platform seller fees, billed directly to client

## exclusions_social
<!-- branch: social -->

- Community management (responses to comments/DMs) is not included and remains the client's responsibility
- Stories, paid advertising, influencer fees, and licensed music

## exclusions_ai_tool
<!-- branch: ai_tool; needs_review: true (review in the master's AI Tool Build section) -->

- Third-party software subscriptions, API usage fees, and hosting costs, billed directly to client
- Changes to the client's other software systems beyond the integrations named above
- New features or tools beyond this scope, quoted separately

## timeline_intro
<!-- branch: all -->

Target launch/start date: {{target_launch}}. This date is contingent on the dependencies listed in Section {{dependencies_section_number}}. Each dependency missed shifts the date by an equal number of calendar days.

## timeline_gate_row
<!-- branch: all -->

SOW executed and {{first_payment}} received. Work does not begin until both are complete.

## timeline_week1_row
<!-- branch: all -->

Kickoff call, intake, asset handoff, admin access granted.

## dependencies_intro
<!-- branch: all -->

The timeline above assumes {{client_name}} meets the following. These are the most common causes of delay and are called out specifically for that reason.

## dependencies_contact
<!-- branch: all -->

{{client_name}} will designate a point of contact responsible for providing content and approvals. Approvals and change requests are submitted and confirmed by email.

## ownership
<!-- branch: all -->

- {{client_name}} owns 100% of the {{owned_assets}} produced under this SOW upon completion and payment
- {{client_name}} retains administrator access to all platforms and accounts throughout the engagement
- Should the engagement end, all logins, assets, and documentation are transferred so another agency can take over without rebuilding anything

## reporting
<!-- branch: all -->

Fully Launched provides written reports on a {{reporting_cadence}} basis covering {{reporting_metrics}}. Success is measured against these metrics.

## support
<!-- branch: all -->

- {{support_response}} response to support requests during business days
- Resolution times vary by the nature of the issue

## change_requests_intro
<!-- branch: all -->

Work outside the scope defined in this SOW is billable. Change requests are submitted and approved by email before work begins.

## fees_terms
<!-- branch: all -->

- One-time build fees are billed 50% at execution of this SOW and 50% at launch
- Monthly retainers are billed at the end of each month
- Payment terms: Net 15
- Third-party costs, including platform subscriptions, domain registration, software and API fees, and ad spend, are not included and are billed directly to {{client_name}}

## fees_gate
<!-- branch: all -->

Work does not begin until the executed SOW and {{first_payment}} are received.

## term_termination
<!-- branch: all -->

- No minimum contract length
- There are no termination fees
- Fully Launched continues work through the end of the current billing period
- All logins, assets, and documentation are transferred to {{client_name}} on termination

## package_selection_intro
<!-- branch: all -->

{{client_name}} indicates its selections below. Only selected items are contracted.

## acceptance
<!-- branch: all -->

By signing below, both parties agree to the scope, fees, timeline, and terms set out in this Statement of Work.
