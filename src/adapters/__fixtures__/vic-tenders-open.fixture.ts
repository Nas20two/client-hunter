/**
 * Minimal HTML fixture for VicTendersOpenAdapter.parseOpenList.
 * Derived from a live fetch of https://www.tenders.vic.gov.au/tenders/open
 * (via Jina Reader with X-Respond-With: html).
 */
export const fixtureHtml = `<table>
  <tbody>
    <tr id="tenderRow249237" data-tender-code="PROCF22-000236">
      <td class="tender-code-state">
        <b class="tablesaw-cell-label">RFx Number Status &amp; Type</b>
        <span class="tablesaw-cell-content">
          <b>PROCF22-000236</b>
          <br>
          <span class="tender-row-state">Open</span>
          <br>
          Expression of Interest
        </span>
      </td>
      <td>
        <b class="tablesaw-cell-label">Details</b>
        <span class="tablesaw-cell-content">
          <div>
            <div>
              <a href="/tender/view?id=249237" class="strong tenderRowTitle">
                Road Safety Services Register
              </a>
            </div>
            <div>
              <span class="line-item-detail">Issued by: Transport Accident Commission</span>
            </div>
            <div>
              <span class="line-item-detail">UNSPSC: 80000000 - Management and Business Professionals and Administrative Services</span>
            </div>
          </div>
        </span>
      </td>
      <td class="tender-date">
        <b class="tablesaw-cell-label">Date</b>
        <span class="tablesaw-cell-content">
          <span class="date_label_list">Opened</span>
          <br>
          <span class="opening_date">Fri, 10 March 2023 9:15 am</span>
          <br>
          <span class="date_label_list">Closing</span>
          <br>
          <span class="closing_date">Fri, 01 March 2030 2:00 pm</span>
        </span>
      </td>
    </tr>
    <tr id="tenderRow97410" data-tender-code="ITR-SS-05-2018">
      <td class="tender-code-state">
        <b class="tablesaw-cell-label">RFx Number Status &amp; Type</b>
        <span class="tablesaw-cell-content">
          <b>ITR-SS-05-2018</b>
          <br>
          <span class="tender-row-state">Open</span>
          <br>
          Request for Tender
        </span>
      </td>
      <td>
        <b class="tablesaw-cell-label">Details</b>
        <span class="tablesaw-cell-content">
          <div>
            <div>
              <a href="/tender/view?id=97410" class="strong tenderRowTitle">
                Invitation to Register - Uniforms and Personal Protective Equipment (PPE) Ethical Supplier Register.
              </a>
            </div>
            <div>
              <span class="line-item-detail">Issued by: Department of Treasury and Finance</span>
            </div>
            <div>
              <span class="line-item-detail">UNSPSC 1: 53000000 - Apparel and Luggage and Personal Care Products - 50%</span>
            </div>
            <div>
              <span class="line-item-detail">UNSPSC 2: 46000000 - Defense and Law Enforcement and Security and Safety Equipment and Supplies - 50%</span>
            </div>
          </div>
        </span>
      </td>
      <td class="tender-date">
        <b class="tablesaw-cell-label">Date</b>
        <span class="tablesaw-cell-content">
          <span class="date_label_list">Opened</span>
          <br>
          <span class="opening_date">Tue, 04 September 2018 4:00 pm</span>
          <br>
          <span class="date_label_list">Closing</span>
          <br>
          <span class="closing_date">Fri, 04 August 2028 2:00 pm</span>
        </span>
      </td>
    </tr>
  </tbody>
</table>`;
