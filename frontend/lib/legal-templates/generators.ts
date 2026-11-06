import { TemplateValues } from "./types";
import { convertPesoToWords, formatPhilippineCurrency } from "./number-to-words";

function v(values: TemplateValues, key: string, fallback = "_________________________"): string {
  const val = values[key];
  if (val === undefined || val === null || val.trim() === "") {
    return fallback;
  }
  return val.trim();
}

function vCurr(values: TemplateValues, figKey: string, wordsKey: string): { figures: string; words: string } {
  const rawFig = values[figKey]?.trim() || "";
  const rawWords = values[wordsKey]?.trim() || "";

  let figures = rawFig ? formatPhilippineCurrency(rawFig) : "_________________________";
  let words = rawWords || (rawFig ? convertPesoToWords(rawFig) : "_________________________");

  return { figures, words };
}

// 1. DEED OF ABSOLUTE SALE (Real Property)
export function generateDeedOfAbsoluteSale(vals: TemplateValues): string {
  const curr = vCurr(vals, "purchase_price_figures", "purchase_price_words");
  return `DEED OF ABSOLUTE SALE

KNOW ALL MEN BY THESE PRESENTS:

This DEED OF ABSOLUTE SALE is made, executed and entered into by:

${v(vals, "seller_name")}, of legal age, ${v(vals, "seller_marital_status")}${vals.seller_spouse ? ` to ${v(vals, "seller_spouse")}` : ""}, Filipino, and with residence and postal address at ${v(vals, "seller_address")}, hereinafter referred to as the SELLER

-AND-

${v(vals, "buyer_name")}, of legal age, ${v(vals, "buyer_marital_status")}${vals.buyer_spouse ? ` to ${v(vals, "buyer_spouse")}` : ""}, Filipino, and with residence and postal address at ${v(vals, "buyer_address")}, hereinafter referred to as the BUYER.

WITNESSETH;

WHEREAS, the SELLER is the absolute, true, and sole registered owner of a certain parcel of land with improvements therein situated at ${v(vals, "property_location")}, covered by Transfer Certificate of Title No. ${v(vals, "tct_number")} issued by the Registry of Deeds of ${v(vals, "registry_of_deeds_location", "the Registry of Deeds")}, containing a total area of ${v(vals, "lot_area_words")} (${v(vals, "lot_area_sqm")}) SQUARE METERS, more or less, and more particularly described as follows:

(Technical Description of Transfer Certificate of Title No. ${v(vals, "tct_number")})
A parcel of land (${v(vals, "lot_number", "Lot No. ___")}, ${v(vals, "block_number", "Block No. ___")}), situated in ${v(vals, "property_location")}. Bounded on the North, East, South, and West by respective adjoining lots. Containing an area of ${v(vals, "lot_area_words")} (${v(vals, "lot_area_sqm")}) Square Meters, more or less.

WHEREAS, the SELLER has offered to sell and the BUYER has agreed to purchase the above-described real property together with all improvements found thereon, for the total agreed purchase price of ${curr.words} (${curr.figures}), Philippine Currency;

NOW THEREFORE, for and in consideration of the sum of ${curr.words} (${curr.figures}), Philippine Currency, the full receipt whereof is hereby acknowledged by the SELLER from the BUYER to the SELLER's complete satisfaction, the SELLER hereby SELLS, CEDES, TRANSFERS, and CONVEYS by way of absolute and irrevocable sale unto the BUYER, his/her heirs, successors, and assigns, the aforementioned parcel of land together with all the improvements found therein, free and clear from any and all liens, encumbrances, mortgages, easements, adverse claims, boundary disputes, or expropriation proceedings of whatever nature.

WARRANTY OF TITLE AND FREEDOM FROM ENCUMBRANCES: The SELLER covenants, warrants, and guarantees that he/she has valid title, fee simple ownership, and absolute legal right to convey the Subject Property, and undertakes to warrant and defend the peaceful possession, ownership, and title of the BUYER against any and all adverse claims or evictions by third persons whomsoever pursuant to Articles 1495, 1547, and 1548 of the Civil Code of the Philippines.

REAL ESTATE TAXES: The SELLER warrants that all real property taxes, special assessments, and local dues accruing on the Subject Property up to the date of execution of this Deed have been paid in full, and shall furnish the BUYER with the corresponding Tax Clearance Certificate.

TAXES AND TRANSFER EXPENSES: Capital Gains Tax (CGT) and Documentary Stamp Tax (DST) due on this transaction under the National Internal Revenue Code (NIRC) as amended shall be for the sole account of the SELLER. Local Transfer Tax, registration fees, IT fees of the Registry of Deeds, and all other incidental expenses necessary to issue a new Transfer Certificate of Title in the name of the BUYER shall be for the account of the BUYER.

POSSESSION AND DELIVERY: Upon execution of this Deed and receipt of full consideration, the SELLER shall turn over actual, physical, and peaceful possession of the Subject Property, together with the original Owner's Duplicate Copy of Transfer Certificate of Title No. ${v(vals, "tct_number")}, unto the BUYER.

IN WITNESS WHEREOF, the parties have hereunto set their hands this ${v(vals, "execution_day", "_____")} day of ${v(vals, "execution_month", "_________________")}, ${v(vals, "execution_year", "20___")} at ${v(vals, "execution_city", "________________________")}, Philippines.


_____________________________                  _____________________________
${v(vals, "seller_name")}                                      ${v(vals, "buyer_name")}
(Seller)                                       (Buyer)


SIGNED IN THE PRESENCE OF:


_____________________________                  _____________________________
${v(vals, "witness_1", "Witness 1")}                                ${v(vals, "witness_2", "Witness 2")}


ACKNOWLEDGMENT

REPUBLIC OF THE PHILIPPINES)
${v(vals, "execution_city", "________________________")} ) S.S.

BEFORE ME, a Notary Public for and in the jurisdiction above indicated, this ${v(vals, "execution_day", "_____")} day of ${v(vals, "execution_month", "_________________")}, ${v(vals, "execution_year", "20___")}, personally appeared:

Name: ${v(vals, "seller_name")}
Competent Evidence of Identity: ${v(vals, "seller_id_details", "_________________________")}

Name: ${v(vals, "buyer_name")}
Competent Evidence of Identity: ${v(vals, "buyer_id_details", "_________________________")}

known to me and to me known to be the same persons who executed the foregoing instrument and acknowledged to me that the same is their free and voluntary act and deed.

This instrument consists of two (2) pages, including the page on which this acknowledgment is written, and has been signed on each and every page thereof by the concerned parties and their instrumental witnesses.

WITNESS MY HAND AND SEAL on the date and place first above written.

                                               NOTARY PUBLIC

Doc. No. ${v(vals, "notary_doc_no", "_______")};
Page No. ${v(vals, "notary_page_no", "_______")};
Book No. ${v(vals, "notary_book_no", "_______")};
Series of ${v(vals, "notary_series", "20___")}.`;
}

// 2. TEMPLATE-DOAS (Alternative DOAS)
export function generateTemplateDOAS(vals: TemplateValues): string {
  const curr = vCurr(vals, "purchase_price_figures", "purchase_price_words");
  return `DEED OF ABSOLUTE SALE

KNOW ALL MEN BY THESE PRESENTS:

This Deed of Absolute Sale is made and executed by:

${v(vals, "seller_name")}, of legal age, Filipino, ${v(vals, "seller_marital_status")}${vals.seller_spouse ? ` to ${v(vals, "seller_spouse")}` : ""} and residing at ${v(vals, "seller_address")} (hereinafter referred to as the SELLER),

- AND -

${v(vals, "buyer_name")}, of legal age, Filipino, ${v(vals, "buyer_marital_status")}${vals.buyer_spouse ? ` to ${v(vals, "buyer_spouse")}` : ""} and residing at ${v(vals, "buyer_address")} (hereinafter referred to as the BUYER).

WITNESSETH; That:

WHEREAS, the SELLER is the absolute, true, and lawful registered owner of a certain parcel of land situated in ${v(vals, "property_location")}, covered by Transfer Certificate of Title No. ${v(vals, "tct_number")}, issued by the Registry of Deeds, more particularly described as follows:

Lot No.: ${v(vals, "lot_number", "___")}
Block No.: ${v(vals, "block_number", "___")}
Location: ${v(vals, "property_location")}
Area: ${v(vals, "lot_area_sqm") || v(vals, "property_area_sqm", "_____")} Square Meters, more or less.

WHEREAS, the BUYER has offered to purchase the above-described real property and the SELLER has agreed to sell the same unto the BUYER for the agreed purchase price of ${curr.words} (${curr.figures}), Philippine Currency;

NOW THEREFORE, for and in consideration of the sum of ${curr.words} (${curr.figures}), receipt whereof is hereby acknowledged by the SELLER from the BUYER, the SELLER does hereby SELL, TRANSFER, and CONVEY by way of Absolute Sale unto the BUYER, his/her heirs and assigns, the aforementioned parcel of land, free from any and all liens, encumbrances, or adverse claims of any kind or nature whatsoever.

The SELLER warrants that the title to the said property is clean and marketable, that there are no adverse claimants thereto, that all real property taxes have been paid up to the execution hereof, and warrants the peaceful possession of the property unto the BUYER forever pursuant to the provisions of the Civil Code of the Philippines.

Capital Gains Tax and Documentary Stamp Tax shall be borne exclusively by the SELLER, while Local Transfer Tax, Registry of Deeds fees, and all other transfer registration charges shall be borne by the BUYER.

IN WITNESS WHEREOF, the parties hereto have signed this instrument this ${v(vals, "execution_day", "_____")} day of ${v(vals, "execution_month", "_________________")}, ${v(vals, "execution_year", "20___")} at ${v(vals, "execution_city", "________________________")}, Philippines.


_____________________________                  _____________________________
${v(vals, "seller_name")}                                      ${v(vals, "buyer_name")}
Seller                                         Buyer


With my marital consent:                       With my marital consent:

_____________________________                  _____________________________
${v(vals, "seller_spouse", "Spouse of Seller")}                         ${v(vals, "buyer_spouse", "Spouse of Buyer")}


SIGNED IN THE PRESENCE OF:

_____________________________                  _____________________________
${v(vals, "witness_1", "Witness 1")}                                ${v(vals, "witness_2", "Witness 2")}


ACKNOWLEDGMENT

REPUBLIC OF THE PHILIPPINES)
${v(vals, "execution_city", "________________________")} ) S.S.

BEFORE ME, a Notary Public in and for the City of ${v(vals, "execution_city", "________________________")}, Philippines, on this ${v(vals, "execution_day", "_____")} day of ${v(vals, "execution_month", "_________________")}, ${v(vals, "execution_year", "20___")}, personally appeared the parties with their competent proof of identities, known to me and to me known to be the same persons who executed the foregoing Deed of Absolute Sale, and acknowledged to me that the same is their free and voluntary act and deed.

This instrument relates to a Deed of Absolute Sale consisting of three (3) pages including this page on which this acknowledgment is written, and signed by the parties and their instrumental witnesses on each and every page.

WITNESS MY HAND AND NOTARIAL SEAL.

                                               NOTARY PUBLIC

Doc. No. ${v(vals, "notary_doc_no", "_______")};
Page No. ${v(vals, "notary_page_no", "_______")};
Book No. ${v(vals, "notary_book_no", "_______")};
Series of ${v(vals, "notary_series", "20___")}.`;
}

// 3. DEED OF SALE OF MOTOR VEHICLE
export function generateDeedOfSaleMotorVehicle(vals: TemplateValues): string {
  const curr = vCurr(vals, "purchase_price_figures", "purchase_price_words");
  return `DEED OF SALE OF MOTOR VEHICLE

KNOW ALL MEN BY THESE PRESENTS:

That I, ${v(vals, "seller_name")}, Filipino, of legal age, and resident of ${v(vals, "seller_address")}, for and in consideration of the sum of ${curr.words} (${curr.figures}), Philippine Currency, to me in hand paid by ${v(vals, "buyer_name")}, of legal age, Filipino, and resident of ${v(vals, "buyer_address")}, the receipt whereof is hereby acknowledged to my entire satisfaction, do hereby SELL, TRANSFER, and CONVEY unto the said ${v(vals, "buyer_name")}, his/her heirs and assigns, that certain motor vehicle described as follows:

MAKE: ${v(vals, "vehicle_make")}
SERIES: ${v(vals, "vehicle_series")}
TYPE OF BODY: ${v(vals, "vehicle_type")}
MOTOR NO.: ${v(vals, "vehicle_motor_no")}
CHASSIS NO.: ${v(vals, "vehicle_chassis_no")}
PLATE NO.: ${v(vals, "vehicle_plate_no")}
MVR/CR NO.: ${v(vals, "vehicle_mvr_no")}

of which motor vehicle I am the absolute and registered owner, free from any and all liens and encumbrances.

I hereby warrant valid title to the said motor vehicle, with full right and power to dispose of the same, and agree to defend the ownership thereof against all lawful claims whatsoever.

IN WITNESS WHEREOF, I have hereunto set my hand this ${v(vals, "execution_day", "_____")} day of ${v(vals, "execution_month", "_________________")}, ${v(vals, "execution_year", "20___")} at ${v(vals, "execution_city", "________________________")}, Philippines.


_____________________________                  _____________________________
${v(vals, "seller_name")}                                      ${v(vals, "buyer_name")}
Vendor / Seller                                Vendee / Buyer


SIGNED IN THE PRESENCE OF:

_____________________________                  _____________________________
${v(vals, "witness_1", "Witness 1")}                                ${v(vals, "witness_2", "Witness 2")}


ACKNOWLEDGMENT

REPUBLIC OF THE PHILIPPINES)
${v(vals, "execution_city", "________________________")} ) S.S.

BEFORE ME, a Notary Public for and in ${v(vals, "execution_city", "________________________")}, personally appeared ${v(vals, "seller_name")}, known to me and to me known to be the same person who executed the foregoing Deed of Sale of Motor Vehicle, and acknowledged to me that the same is his/her free and voluntary act and deed.

WITNESS MY HAND AND SEAL this ${v(vals, "execution_day", "_____")} day of ${v(vals, "execution_month", "_________________")}, ${v(vals, "execution_year", "20___")}.

                                               NOTARY PUBLIC

Doc. No. ${v(vals, "notary_doc_no", "_______")};
Page No. ${v(vals, "notary_page_no", "_______")};
Book No. ${v(vals, "notary_book_no", "_______")};
Series of ${v(vals, "notary_series", "20___")}.`;
}

// 4. DEED OF DONATION
export function generateDeedOfDonation(vals: TemplateValues): string {
  const curr = vCurr(vals, "property_value_figures", "property_value_words");
  return `DEED OF DONATION

KNOW ALL MEN BY THESE PRESENTS:

That I, ${v(vals, "donor_name")}, of legal age, ${v(vals, "donor_marital_status")}${vals.donor_spouse ? ` to ${v(vals, "donor_spouse")}` : ""}, with residence at ${v(vals, "donor_address")}, hereinafter called the DONOR;

- and -

${v(vals, "donee_name")}, of legal age, ${v(vals, "donee_marital_status")}${vals.donee_spouse ? ` to ${v(vals, "donee_spouse")}` : ""}, with residence at ${v(vals, "donee_address")}, hereinafter called the DONEE;

WITNESSETH:

That the DONOR is the true, absolute, and lawful owner of that certain real or personal property described as follows:

${v(vals, "property_description")}
Estimated Fair Market Value: ${curr.words} (${curr.figures}).

That for and in consideration of the love and affection which the DONOR bears for the DONEE, being the ${v(vals, "donee_relationship", "beloved relative / son / daughter")} of the DONOR, the DONOR by these presents does hereby CEDE, TRANSFER, and CONVEY by way of DONATION INTER VIVOS unto the said DONEE, his/her heirs and assigns, the above-described property, free from all liens and encumbrances.

That the DONOR hereby reserves unto himself/herself sufficient property or income for his/her sustenance and support according to his/her station in life.

ACCEPTANCE

The DONEE hereby ACCEPTS with profound gratitude the donation of the above-described property made in his/her favor by the DONOR, and conveys his/her sincerest appreciation for the generosity and benevolence manifested.

IN WITNESS WHEREOF, the DONOR and the DONEE have executed this instrument this ${v(vals, "execution_day", "_____")} day of ${v(vals, "execution_month", "_________________")}, ${v(vals, "execution_year", "20___")} at ${v(vals, "execution_city", "________________________")}, Philippines.


_____________________________                  _____________________________
${v(vals, "donor_name")}                                       ${v(vals, "donee_name")}
DONOR                                          DONEE


SIGNED IN THE PRESENCE OF:

_____________________________                  _____________________________
${v(vals, "witness_1", "Witness 1")}                                ${v(vals, "witness_2", "Witness 2")}


ACKNOWLEDGMENT

REPUBLIC OF THE PHILIPPINES)
${v(vals, "execution_city", "________________________")} ) S.S.

BEFORE ME, a Notary Public in and for ${v(vals, "execution_city", "________________________")}, this ${v(vals, "execution_day", "_____")} day of ${v(vals, "execution_month", "_________________")}, ${v(vals, "execution_year", "20___")}, personally appeared the DONOR and DONEE, known to me and to me known to be the same persons who executed the foregoing Deed of Donation, and they acknowledged to me that the same is their free and voluntary act and deed.

WITNESS MY HAND AND NOTARIAL SEAL.

                                               NOTARY PUBLIC

Doc. No. ${v(vals, "notary_doc_no", "_______")};
Page No. ${v(vals, "notary_page_no", "_______")};
Book No. ${v(vals, "notary_book_no", "_______")};
Series of ${v(vals, "notary_series", "20___")}.`;
}

// 5. DEED OF ASSIGNMENT AND TRANSFER OF RIGHTS
export function generateDeedOfAssignment(vals: TemplateValues): string {
  const curr = vCurr(vals, "consideration_figures", "consideration_words");
  return `DEED OF ASSIGNMENT AND TRANSFER OF RIGHTS

KNOW ALL MEN BY THIS PRESENTS:

This deed, made and entered into this ${v(vals, "execution_day", "_____")} day of ${v(vals, "execution_month", "_________________")}, ${v(vals, "execution_year", "20___")} at ${v(vals, "execution_city", "________________________")}, Philippines, by and between:

${v(vals, "assignor_name")}, of legal age, Filipino, ${v(vals, "assignor_marital_status")}${vals.assignor_spouse ? ` to ${v(vals, "assignor_spouse")}` : ""}, with residence and postal address at ${v(vals, "assignor_address")}, hereinafter known as the ASSIGNOR;

- AND -

${v(vals, "assignee_name")}, of legal age, Filipino, ${v(vals, "assignee_marital_status")}${vals.assignee_spouse ? ` to ${v(vals, "assignee_spouse")}` : ""}, with residence and postal address at ${v(vals, "assignee_address")}, hereinafter known as the ASSIGNEE.

WITNESSETH:

WHEREAS, the ASSIGNOR is the buyer and holder of rights over that certain real estate property / unit described as:
${v(vals, "subject_property_description")}
from the Developer/Owner, ${v(vals, "developer_or_owner_name", "the Developer/Owner")};

WHEREAS, the ASSIGNOR has offered to assign, cede, and transfer all his/her rights, title, interests, and equity over the said property unto the ASSIGNEE, and the ASSIGNEE has agreed to accept the same for the agreed consideration;

NOW, THEREFORE, for and in consideration of the sum of ${curr.words} (${curr.figures}), Philippine Currency, paid in full by the ASSIGNEE to the ASSIGNOR, the receipt whereof is hereby acknowledged, the ASSIGNOR does hereby ASSIGN, TRANSFER, and CONVEY unto the ASSIGNEE all his/her rights, interests, and obligations in and to the aforementioned property under the contracts and agreements executed with the Developer.

The ASSIGNEE hereby accepts this assignment and agrees to assume all future payments, obligations, and terms specified in the contract with the Developer.

IN WITNESS WHEREOF, the parties have signed this instrument on the date and place first above written.


_____________________________                  _____________________________
${v(vals, "assignor_name")}                                    ${v(vals, "assignee_name")}
ASSIGNOR                                       ASSIGNEE


SIGNED IN THE PRESENCE OF:

_____________________________                  _____________________________
${v(vals, "witness_1", "Witness 1")}                                ${v(vals, "witness_2", "Witness 2")}


ACKNOWLEDGMENT

REPUBLIC OF THE PHILIPPINES)
${v(vals, "execution_city", "________________________")} ) S.S.

BEFORE ME, a Notary Public in and for ${v(vals, "execution_city", "________________________")}, this ${v(vals, "execution_day", "_____")} day of ${v(vals, "execution_month", "_________________")}, ${v(vals, "execution_year", "20___")}, personally appeared the ASSIGNOR and the ASSIGNEE, known to me to be the same persons who executed this Deed of Assignment and Transfer of Rights, and acknowledged that the same is their free and voluntary act and deed.

WITNESS MY HAND AND SEAL.

                                               NOTARY PUBLIC

Doc. No. ${v(vals, "notary_doc_no", "_______")};
Page No. ${v(vals, "notary_page_no", "_______")};
Book No. ${v(vals, "notary_book_no", "_______")};
Series of ${v(vals, "notary_series", "20___")}.`;
}

// 6. CONTRACT OF LEASE TEMPLATE
export function generateContractOfLeaseTemplate(vals: TemplateValues): string {
  const rent = vCurr(vals, "monthly_rent_figures", "monthly_rent_words");
  return `CONTRACT OF LEASE

KNOW ALL MEN BY THESE PRESENTS:

This CONTRACT OF LEASE is made and executed at the City of ${v(vals, "execution_city", "[City]")}, this ${v(vals, "execution_day", "[Day]")} day of ${v(vals, "execution_month", "[Month]")}, ${v(vals, "execution_year", "[Year]")}, by and between:

${v(vals, "lessor_name", "[NAME OF LESSOR]")}, of legal age, ${v(vals, "lessor_civil_status", "[Civil Status]")}, Filipino, and with residence and postal address at ${v(vals, "lessor_address", "[Address of Lessor]")}, hereinafter referred to as the LESSOR.

-AND-

${v(vals, "lessee_name", "[NAME OF LESSEE]")}, of legal age, ${v(vals, "lessee_civil_status", "[Civil Status]")}, Filipino, and with residence and postal address at ${v(vals, "lessee_address", "[Address of Lessee]")}, hereinafter referred to as the LESSEE.

WITNESSETH; That:

WHEREAS, the LESSOR is the absolute owner of that certain residential/commercial leased premises situated at:
${v(vals, "leased_premises_address", "[Address of Leased Premises]")};

WHEREAS, the LESSOR agrees to lease-out the property unto the LESSEE and the LESSEE is willing to lease the same;

NOW THEREFORE, for and in consideration of the payments of rentals and other covenants hereinafter contained, the LESSOR hereby leases unto the LESSEE the above-described premises under the following conditions:

1. TERM: This lease shall be for a period of ${v(vals, "lease_term_months", "One (1) Year")} commencing from ${v(vals, "lease_start_date", "_____________")} to ${v(vals, "lease_end_date", "_____________")}, renewable upon mutual written agreement of both parties.

2. RENTAL RATE: The monthly rental rate for the leased premises shall be ${rent.words} (${rent.figures}), Philippine Currency, payable within the first five (5) days of each calendar month.

3. ADVANCE & DEPOSIT: Upon signing of this contract, the LESSEE shall pay the amount of ${vals.advance_rent_figures ? formatPhilippineCurrency(vals.advance_rent_figures) : "_________________________"} as advance rental and ${vals.security_deposit_figures ? formatPhilippineCurrency(vals.security_deposit_figures) : "_________________________"} as security deposit to answer for unpaid utilities or damages upon turnover.

4. USE OF PREMISES: The premises shall be used exclusively for lawful residential or office purposes and the LESSEE shall not sublease the premises or any part thereof without prior written consent of the LESSOR.

5. UTILITIES: All public utilities including electricity, water, telephone, and internet services shall be for the account of the LESSEE.

6. REPAIRS AND MAINTENANCE: The LESSEE shall keep the premises in clean, sanitary, and good tenable condition. Minor repairs resulting from daily use shall be for the account of the LESSEE, while major structural repairs shall be for the account of the LESSOR.

7. DEFAULT AND TERMINATION: In the event of default in rental payment for two consecutive months or material violation of any provision hereof, the LESSOR shall have the legal right to terminate this lease and forfeit the security deposit, and exercise all lawful remedies pursuant to Article 1673 of the Civil Code of the Philippines.

IN WITNESS WHEREOF, the parties have signed this lease agreement on the date and place first written above.


_____________________________                  _____________________________
${v(vals, "lessor_name", "LESSOR")}                                      ${v(vals, "lessee_name", "LESSEE")}
LESSOR                                         LESSEE


SIGNED IN THE PRESENCE OF:

_____________________________                  _____________________________
${v(vals, "witness_1", "Witness 1")}                                ${v(vals, "witness_2", "Witness 2")}


ACKNOWLEDGMENT

REPUBLIC OF THE PHILIPPINES)
${v(vals, "execution_city", "________________________")} ) S.S.

BEFORE ME, a Notary Public for and in ${v(vals, "execution_city", "________________________")}, this ${v(vals, "execution_day", "_____")} day of ${v(vals, "execution_month", "_________________")}, ${v(vals, "execution_year", "20___")}, personally appeared the LESSOR and LESSEE, known to me to be the same persons who executed this Contract of Lease and acknowledged that the same is their free and voluntary act and deed.

WITNESS MY HAND AND NOTARIAL SEAL.

                                               NOTARY PUBLIC

Doc. No. ${v(vals, "notary_doc_no", "_______")};
Page No. ${v(vals, "notary_page_no", "_______")};
Book No. ${v(vals, "notary_book_no", "_______")};
Series of ${v(vals, "notary_series", "20___")}.`;
}

// 7. LEASE CONTRACT (Comprehensive)
export function generateLeaseContract(vals: TemplateValues): string {
  const rent = vCurr(vals, "monthly_rental_figures", "monthly_rental_words");
  return `LEASE CONTRACT

KNOW ALL MEN BY THESE PRESENTS:

This CONTRACT OF LEASE is made and executed at the City of ${v(vals, "execution_city", "_____")}, this ${v(vals, "execution_day", "_____")} day of ${v(vals, "execution_month", "_______________")}, ${v(vals, "execution_year", "20____")}, by and between:

${v(vals, "lessor_name", "(NAME OF LESSOR)")}, of legal age, ${v(vals, "lessor_marital_status", "single/married")}${vals.lessor_spouse ? ` to ${v(vals, "lessor_spouse")}` : ""}, Filipino, and with residence and postal address at ${v(vals, "lessor_address", "(Address)")}, hereinafter referred to as the LESSOR.

-AND-

${v(vals, "lessee_name", "(NAME OF LESSEE)")}, Filipino, of legal age, ${v(vals, "lessee_marital_status", "single/married")}${vals.lessee_spouse ? ` to ${v(vals, "lessee_spouse")}` : ""}, and with residence and postal address at ${v(vals, "lessee_address", "(Address)")}, hereinafter referred to as the LESSEE.

WITNESSETH; That:

WHEREAS, the LESSOR is the registered owner of the leased premises situated at:
${v(vals, "leased_premises_description", "(Address and Description of Leased Property)")};

WHEREAS, the LESSOR agrees to lease out the said property unto the LESSEE and the LESSEE agrees to accept the lease under the following terms and conditions:

1. PURPOSES: The premises hereby leased shall be used exclusively by the LESSEE for ${v(vals, "lease_purpose", "Residential purposes only")} and shall not be diverted to other uses without prior written consent of the LESSOR.

2. TERM: This term of lease is for ${v(vals, "lease_term_years_or_months", "One (1) Year")}, renewable at the option of both parties under renegotiated conditions.

3. RENTAL RATE: The monthly rental rate for the leased premises shall be ${rent.words} (${rent.figures}), Philippine Currency. All payments must be deposited directly to the LESSOR's designated bank account.

4. DEPOSITS: The LESSEE shall deposit the amount of ${vals.advance_deposit_figures ? formatPhilippineCurrency(vals.advance_deposit_figures) : "_________________________"} as advance rental and ${vals.security_deposit_figures ? formatPhilippineCurrency(vals.security_deposit_figures) : "_________________________"} as security deposit.

5. SUB-LEASE: The LESSEE shall not directly or indirectly assign, sublease, or encumber the leased premises in whole or in part without the prior written consent of the LESSOR.

6. DEFAULT & BREACH: In the event of default in rental payments for two consecutive months, the LESSOR shall have the right to padlock the premises and declare the contract rescinded with forfeiture of deposits as liquidated damages.

IN WITNESS WHEREOF, the parties have hereunto set their hands on this ${v(vals, "execution_day", "_____")} day of ${v(vals, "execution_month", "_______________")}, ${v(vals, "execution_year", "20____")} at ${v(vals, "execution_city", "_____")}, Philippines.


_____________________________                  _____________________________
${v(vals, "lessor_name", "LESSOR")}                                      ${v(vals, "lessee_name", "LESSEE")}
LESSOR                                         LESSEE


SIGNED IN THE PRESENCE OF:

_____________________________                  _____________________________
${v(vals, "witness_1", "Witness 1")}                                ${v(vals, "witness_2", "Witness 2")}


ACKNOWLEDGMENT

REPUBLIC OF THE PHILIPPINES)
${v(vals, "execution_city", "________________________")} ) S.S.

BEFORE ME, a Notary Public for and in ${v(vals, "execution_city", "________________________")}, this ${v(vals, "execution_day", "_____")} day of ${v(vals, "execution_month", "_______________")}, ${v(vals, "execution_year", "20____")}, personally appeared the LESSOR and LESSEE, known to me to be the same persons who executed this Contract of Lease and acknowledged that the same is their free and voluntary act and deed.

WITNESS MY HAND AND SEAL.

                                               NOTARY PUBLIC

Doc. No. ${v(vals, "notary_doc_no", "_______")};
Page No. ${v(vals, "notary_page_no", "_______")};
Book No. ${v(vals, "notary_book_no", "_______")};
Series of ${v(vals, "notary_series", "20___")}.`;
}

// 8. RENT TO OWN CONTRACT
export function generateRentToOwnContract(vals: TemplateValues): string {
  const rent = vCurr(vals, "monthly_rent_figures", "monthly_rent_words");
  const purchase = vCurr(vals, "total_purchase_price_figures", "total_purchase_price_words");

  return `RENT TO OWN CONTRACT

This Contract of Lease with Option to Purchase (Rent-to-Own Contract) made and executed this ${v(vals, "execution_day", "____")} of ${v(vals, "execution_month", "__________")}, ${v(vals, "execution_year", "20___")} at ${v(vals, "execution_city", "Manila")}, Philippines by and between:

${v(vals, "lessor_seller_name")}, Filipino, of legal age, ${v(vals, "lessor_seller_civil_status")}${vals.lessor_seller_spouse ? ` to ${v(vals, "lessor_seller_spouse")}` : ""}, with postal address at ${v(vals, "lessor_seller_address")}, hereinafter referred to as the LESSOR/SELLER;

-AND-

${v(vals, "lessee_buyer_name")}, Filipino, of legal age, ${v(vals, "lessee_buyer_civil_status")}${vals.lessee_buyer_spouse ? ` to ${v(vals, "lessee_buyer_spouse")}` : ""}, with postal address at ${v(vals, "lessee_buyer_address")}, hereinafter referred to as the LESSEE/BUYER.

WITNESSETH:

WHEREAS, the LESSOR/SELLER is the owner of a parcel of land / condominium unit located at:
${v(vals, "property_description")}

WHEREAS, the LESSOR/SELLER agrees to lease the property to the LESSEE/BUYER with an exclusive Option to Purchase the property under the following terms:

1. LEASE PERIOD: The term of the lease shall be for ${v(vals, "lease_period_months_or_years", "Three (3) Years")}.

2. MONTHLY RENTAL: The monthly rental for the premises shall be ${rent.words} (${rent.figures}), Philippine Currency.

3. OPTION TO PURCHASE: During the lease period, the LESSEE/BUYER is granted the exclusive option to purchase the property for the total purchase price of ${purchase.words} (${purchase.figures}).

4. RENTAL APPLIED TOWARD PURCHASE: A portion of the monthly rental payments equivalent to ${v(vals, "portion_applied_to_purchase_price", "Fifty Percent (50%)")} shall be credited and deducted from the total purchase price if the LESSEE/BUYER exercises the option on or before ${v(vals, "option_period_deadline", "the end of the lease period")}.

5. EXERCISE OF OPTION: Upon complete settlement of the option purchase price and compliance with all covenants herein, the LESSOR/SELLER shall execute a Deed of Absolute Sale in favor of the LESSEE/BUYER.

IN WITNESS WHEREOF, the parties have hereunto set their hands on the date and place first above written.


_____________________________                  _____________________________
${v(vals, "lessor_seller_name")}                               ${v(vals, "lessee_buyer_name")}
LESSOR / SELLER                                LESSEE / BUYER


SIGNED IN THE PRESENCE OF:

_____________________________                  _____________________________
${v(vals, "witness_1", "Witness 1")}                                ${v(vals, "witness_2", "Witness 2")}


ACKNOWLEDGMENT

REPUBLIC OF THE PHILIPPINES)
${v(vals, "execution_city", "________________________")} ) S.S.

BEFORE ME, a Notary Public in and for ${v(vals, "execution_city", "________________________")}, this ${v(vals, "execution_day", "_____")} day of ${v(vals, "execution_month", "__________")}, ${v(vals, "execution_year", "20___")}, personally appeared the LESSOR/SELLER and LESSEE/BUYER, known to me to be the same persons who executed this Rent-to-Own Contract, and they acknowledged that the same is their free and voluntary act and deed.

WITNESS MY HAND AND NOTARIAL SEAL.

                                               NOTARY PUBLIC

Doc. No. ${v(vals, "notary_doc_no", "_______")};
Page No. ${v(vals, "notary_page_no", "_______")};
Book No. ${v(vals, "notary_book_no", "_______")};
Series of ${v(vals, "notary_series", "20___")}.`;
}

// 9. CONTRACT TO SELL
export function generateContractToSell(vals: TemplateValues): string {
  const price = vCurr(vals, "total_contract_price_figures", "total_contract_price_words");
  return `CONTRACT TO SELL

KNOW ALL MEN BY THESE PRESENTS:

This CONTRACT TO SELL, made and executed this ${v(vals, "execution_day", "____")} day of ${v(vals, "execution_month", "_________")}, ${v(vals, "execution_year", "20__")} by and between:

${v(vals, "seller_name", "(NAME OF SELLER/VENDOR)")}, of legal age, ${v(vals, "seller_civil_status", "single/married")}${vals.seller_spouse ? ` to ${v(vals, "seller_spouse")}` : ""}, Filipino, and with residence and postal address at ${v(vals, "seller_address", "(Address)")}, hereinafter referred to as the "SELLER/VENDOR";

-AND-

${v(vals, "buyer_name", "(NAME OF BUYER/VENDEE)")}, Filipino, of legal age, ${v(vals, "buyer_civil_status", "single/married")}${vals.buyer_spouse ? ` to ${v(vals, "buyer_spouse")}` : ""}, and with residence and postal address at ${v(vals, "buyer_address", "(Address)")}, hereinafter referred to as the "BUYER/VENDEE".

WITNESSETH;

WHEREAS, the SELLER/VENDOR is the absolute owner of a parcel of land situated in ${v(vals, "property_location")}, covered by Transfer Certificate of Title No. ${v(vals, "tct_number")}, with Lot No. ${v(vals, "lot_number", "___")}, Block No. ${v(vals, "block_number", "___")}, containing an area of ${v(vals, "lot_area_sqm", "_____")} square meters;

WHEREAS, the BUYER/VENDEE has offered to buy and the SELLER/VENDOR has agreed to sell the above-mentioned property under the following terms:

1. TOTAL CONTRACT PRICE: The agreed consideration is ${price.words} (${price.figures}), Philippine Currency.

2. DOWNPAYMENT: The BUYER/VENDEE shall make an initial downpayment of ${vals.downpayment_words || (vals.downpayment_figures ? formatPhilippineCurrency(vals.downpayment_figures) : "_________________________")}.

3. BALANCE: The remaining balance of ${vals.balance_words || (vals.balance_figures ? formatPhilippineCurrency(vals.balance_figures) : "_________________________")} shall be paid according to the following schedule:
${v(vals, "payment_terms", "As agreed in equal monthly installments...")}

4. DEED OF SALE: Title and ownership to the property shall remain with the SELLER/VENDOR and shall only pass to the BUYER/VENDEE upon full and complete payment of the entire contract price, at which time the SELLER/VENDOR shall execute a Deed of Absolute Sale in favor of the BUYER/VENDEE.

IN WITNESS WHEREOF, the parties have hereunto set their hands on the date and place first above written.


_____________________________                  _____________________________
${v(vals, "seller_name", "SELLER/VENDOR")}                              ${v(vals, "buyer_name", "BUYER/VENDEE")}
SELLER / VENDOR                                BUYER / VENDEE


SIGNED IN THE PRESENCE OF:

_____________________________                  _____________________________
${v(vals, "witness_1", "Witness 1")}                                ${v(vals, "witness_2", "Witness 2")}


ACKNOWLEDGMENT

REPUBLIC OF THE PHILIPPINES)
${v(vals, "execution_city", "________________________")} ) S.S.

BEFORE ME, a Notary Public in and for ${v(vals, "execution_city", "________________________")}, this ${v(vals, "execution_day", "_____")} day of ${v(vals, "execution_month", "_________")}, ${v(vals, "execution_year", "20__")}, personally appeared the SELLER/VENDOR and BUYER/VENDEE, known to me to be the same persons who executed this Contract to Sell, and acknowledged that the same is their free and voluntary act and deed.

WITNESS MY HAND AND SEAL.

                                               NOTARY PUBLIC

Doc. No. ${v(vals, "notary_doc_no", "_______")};
Page No. ${v(vals, "notary_page_no", "_______")};
Book No. ${v(vals, "notary_book_no", "_______")};
Series of ${v(vals, "notary_series", "20___")}.`;
}

// 10. OFFER TO PURCHASE
export function generateOfferToPurchase(vals: TemplateValues): string {
  const price = vCurr(vals, "offered_price_figures", "offered_price_words");
  return `OFFER TO PURCHASE
(Real Estate)

${v(vals, "seller_name", "Mr. Jerry Benitez")}
${v(vals, "seller_address", "18 Sunflower St, New Manila, Quezon City")}

Re: Blk. ${v(vals, "property_block", "___")} Lot ${v(vals, "property_lot", "___")}, ${v(vals, "property_street", "Camilla St., Manila")}; with
lot area of ${v(vals, "lot_area_sqm", "_____")} sqm. more or less; covered
by T.C.T. No. ${v(vals, "tct_number", "______________")}

Dear Sir / Madam,

This is to express our firm offer to buy the above-stated property through our authorized broker, ${v(vals, "broker_name", "the authorized broker")}, subject to the following terms and conditions:

Purchase Price PhP: ${price.figures} (${price.words})

Terms and Conditions:
1) Upon acceptance of this offer, we shall pay an Earnest Money deposit in the amount of ${vals.earnest_money_figures ? formatPhilippineCurrency(vals.earnest_money_figures) : "PhP ___________"}, which shall form part of the purchase price.
2) Downpayment: ${vals.downpayment_figures ? formatPhilippineCurrency(vals.downpayment_figures) : "PhP ___________"} upon execution of the Contract to Sell or Deed of Absolute Sale.
3) Balance Payment Terms:
${v(vals, "balance_terms", "Balance payable via bank financing or managers check within agreed period.")}
4) This offer is valid and binding until ${v(vals, "offer_validity_date", "_______________")}.

If the above terms are acceptable to you, kindly signify your conformity below.

Very truly yours,


_____________________________
${v(vals, "buyer_name", "Victor Benitez")}
(Buyer)
Date: ${v(vals, "buyer_signature_date", "_______________")}


Conforme:


_____________________________
${v(vals, "seller_name", "Victor Benitez")}
(Seller)`;
}

// 11. EARNEST MONEY RECEIPT AGREEMENT
export function generateEarnestMoneyReceipt(vals: TemplateValues): string {
  const earnest = vCurr(vals, "earnest_money_figures", "earnest_money_words");
  return `EARNEST MONEY RECEIPT AGREEMENT

Received from ${v(vals, "buyer_name", "(Name of Buyer)")} with postal address at ${v(vals, "buyer_address", "(Address)")}, the sum of ${earnest.words} (${earnest.figures}), Philippine Currency, as EARNEST MONEY for the purchase of that certain property situated at:

${v(vals, "property_location")}
covered by T.C.T. No. ${v(vals, "property_tct_no", "__________")}, with a lot area of ${v(vals, "property_lot_area", "_____")} square meters, more or less.

Total Agreed Purchase Price: ${vals.total_purchase_price_figures ? formatPhilippineCurrency(vals.total_purchase_price_figures) : "PHP _________________________"}

It is understood that the said Earnest Money forms part of the purchase price. The balance of the purchase price shall be paid on or before ${v(vals, "balance_due_date", "_______________")}, upon which the parties shall execute the Deed of Absolute Sale and transfer possession.

In case of default on the part of the Buyer, the earnest money shall be forfeited in favor of the Seller as liquidated damages. In case of default on the part of the Seller, the earnest money shall be refunded in full to the Buyer without interest.

Done this ${v(vals, "execution_day", "_____")} day of ${v(vals, "execution_month", "_______________")}, ${v(vals, "execution_year", "20___")} at ${v(vals, "execution_city", "________________________")}, Philippines.


_____________________________                  _____________________________
${v(vals, "seller_name", "(Name of Seller)")}                           ${v(vals, "buyer_name", "(Name of Buyer)")}
Seller                                         Buyer


SIGNED IN THE PRESENCE OF:

_____________________________                  _____________________________
${v(vals, "witness_1", "Witness 1")}                                ${v(vals, "witness_2", "Witness 2")}`;
}

// 12. EXCLUSIVE (OR NON-EXCLUSIVE) AUTHORITY TO SELL (OR LEASE)
export function generateAuthorityToSell(vals: TemplateValues): string {
  const price = vCurr(vals, "asking_price_figures", "asking_price_words");
  const authType = v(vals, "authority_type", "EXCLUSIVE");
  const authAction = v(vals, "authority_action", "SELL");

  return `${authType} AUTHORITY TO ${authAction}

THIS IS TO AUTHORIZE ${v(vals, "agent_name", "(Name of Broker)")}, of legal age, a resident of ${v(vals, "agent_address", "(Address)")}, as my/our authorized representative to market and broker the ${authAction.toLowerCase()} of the property described as follows:

PROPERTY DESCRIPTION:
${v(vals, "property_description")}

TERMS AND CONDITIONS:
1. Asking Price / Rental: ${price.words} (${price.figures}), Philippine Currency.
2. Broker's Commission: The broker shall be entitled to a commission equivalent to ${v(vals, "commission_percentage", "5%")} of the actual gross consideration.
3. Term: This authority shall be valid for a period of ${v(vals, "authority_duration_months", "6 months")} commencing from the date hereof until ${v(vals, "validity_expiry_date", "_______________")}.
4. Holdover Clause: If the property is sold or leased within ninety (90) days after the expiration of this authority to a buyer registered by the Broker, the commission remains due to the Broker.

Executed this ${v(vals, "execution_date", "_____ day of ____________, 20___")} at ${v(vals, "execution_place", "________________________")}, Philippines.


_____________________________
${v(vals, "owner_name", "(Name of Owner/Principal)")}
Owner / Principal

CONFORME:

_____________________________
${v(vals, "agent_name", "(Name of Broker/Agent)")}
Broker / Agent`;
}

// 13. ACKNOWLEDGEMENT OF DEBT
export function generateAcknowledgementOfDebt(vals: TemplateValues): string {
  const debt = vCurr(vals, "debt_amount_figures", "debt_amount_words");
  return `ACKNOWLEDGEMENT OF DEBT

KNOW ALL MEN BY THESE PRESENTS:

I, ${v(vals, "debtor_name")}, Filipino, of legal age, ${v(vals, "debtor_civil_status")}${vals.debtor_spouse ? ` to ${v(vals, "debtor_spouse")}` : ""} with postal address at ${v(vals, "debtor_address")} witnesseth:

That I am indebted in the sum of ${debt.words} (${debt.figures}), Philippine Currency, to ${v(vals, "creditor_name")} also a Filipino, of legal age, ${v(vals, "creditor_civil_status")}${vals.creditor_spouse ? ` to ${v(vals, "creditor_spouse")}` : ""} with postal address at ${v(vals, "creditor_address")};

That I promise to pay the said amount on ${v(vals, "due_date")} at ${v(vals, "payment_place", "the address of the Creditor")}, without need of any demand;

That in the event that I fail to pay the said amount on the date above specified, I promise to pay an interest of ${v(vals, "interest_rate_percent", "_____ percent")} per month from the date of default until fully paid;

That in case of judicial execution of this obligation, I promise to pay an additional sum of ${v(vals, "attorney_fees_percent", "_____ percent")} of the total amount due as and for attorney's fees, aside from the costs of suit.

IN WITNESS WHEREOF, I have hereunto set my hand this ${v(vals, "execution_day", "_____")} day of ${v(vals, "execution_month", "________________")}, ${v(vals, "execution_year", "20____")} at ${v(vals, "execution_city", "________________________________")}.


_____________________________
${v(vals, "debtor_name")}
(Debtor)


SIGNED IN THE PRESENCE OF:

_____________________________                  _____________________________
${v(vals, "witness_1", "Witness 1")}                                ${v(vals, "witness_2", "Witness 2")}


ACKNOWLEDGMENT

REPUBLIC OF THE PHILIPPINES)
${v(vals, "execution_city", "_____________________________")} ) S.S.

BEFORE ME, a Notary Public for and in the ${v(vals, "execution_city", "____________________")}, this ${v(vals, "execution_day", "_____")} day of ${v(vals, "execution_month", "__________________")}, ${v(vals, "execution_year", "20____")}, personally appeared ${v(vals, "debtor_name")}, with Community Tax Certificate No. / ID ${v(vals, "debtor_id_details", "_________________")}, known to me and to me known to be the same person who executed the foregoing instrument and acknowledged to me that the same is his/her free and voluntary act and deed.

WITNESS MY HAND AND SEAL on the date and place first above written.

                                               NOTARY PUBLIC

Doc. No. ${v(vals, "notary_doc_no", "_______")};
Page No. ${v(vals, "notary_page_no", "_______")};
Book No. ${v(vals, "notary_book_no", "_______")};
Series of ${v(vals, "notary_series", "20____")}.`;
}

// 14. ACKNOWLEDGEMENT RECEIPT
export function generateAcknowledgementReceipt(vals: TemplateValues): string {
  const amt = vCurr(vals, "amount_figures", "amount_words");
  return `ACKNOWLEDGEMENT RECEIPT

Received from ${v(vals, "received_from", "Atty. Juan Santos")} the amount of ${amt.words} (${amt.figures}) Philippine Currency (${v(vals, "check_or_payment_details", "BPI Manila Branch check # 12345-67890")}) representing the payment of:

${v(vals, "payment_purpose", "Two (2) months deposit and one (1) month advance for the lease of condominium unit.")}

Received by:

_____________________________
${v(vals, "received_by", "Victor Gonzalez")}
${v(vals, "payee_role", "Lessor")}

Date Received:
${v(vals, "date_received", "_____________________")}

Note: This Acknowledgement Receipt serves as valid proof of payment for services rendered, rental payments, or other financial transactions.`;
}

// 15. PROMISSORY NOTE
export function generatePromissoryNote(vals: TemplateValues): string {
  const amt = vCurr(vals, "principal_amount_figures", "principal_amount_words");
  return `PROMISSORY NOTE

I, ${v(vals, "maker_name")}, Filipino, of legal age, ${v(vals, "maker_civil_status")}${vals.maker_spouse ? ` to ${v(vals, "maker_spouse")}` : ""} and a resident of ${v(vals, "maker_address")} for value received, hereby acknowledge my indebtedness to ${v(vals, "payee_name")}.

I promise to pay the amount of PESOS: ${amt.words} (${amt.figures}) on or before ${v(vals, "due_date")} without a need of a demand.

I understand and agree to pay ${v(vals, "interest_rate_percent", "______%")} interest per ${v(vals, "interest_period", "month")} starting from the date of default until the obligation is paid in full.

In case of judicial proceedings to enforce the collection of this note, I promise to pay an additional sum of 20% of the principal and accrued interest as attorney's fees, in addition to the costs of the suit.

Signed this ${v(vals, "execution_day", "_____")} day of ${v(vals, "execution_month", "________________")}, ${v(vals, "execution_year", "20___")} at ${v(vals, "execution_city", "________________________")}, Philippines.


_____________________________
${v(vals, "maker_name")}
(Maker / Borrower)


WITNESSES:

_____________________________                  _____________________________
${v(vals, "witness_1", "Witness 1")}                                ${v(vals, "witness_2", "Witness 2")}


ACKNOWLEDGMENT

REPUBLIC OF THE PHILIPPINES)
${v(vals, "execution_city", "________________________")} ) S.S.

BEFORE ME, this ${v(vals, "execution_day", "_____")} day of ${v(vals, "execution_month", "________________")}, ${v(vals, "execution_year", "20___")}, personally appeared ${v(vals, "maker_name")}, known to me to be the person who executed the foregoing Promissory Note and acknowledged that the same is his/her voluntary act and deed.

WITNESS MY HAND AND SEAL.

                                               NOTARY PUBLIC

Doc. No. ${v(vals, "notary_doc_no", "_______")};
Page No. ${v(vals, "notary_page_no", "_______")};
Book No. ${v(vals, "notary_book_no", "_______")};
Series of ${v(vals, "notary_series", "20___")}.`;
}

// 16. CHATTEL MORTGAGE
export function generateChattelMortgage(vals: TemplateValues): string {
  const debt = vCurr(vals, "indebtedness_amount_figures", "indebtedness_amount_words");
  return `CHATTEL MORTGAGE

KNOW ALL MEN BY THESE PRESENTS:

I, ${v(vals, "mortgagor_name", "(Name of Mortgagor)")} of legal age, ${v(vals, "mortgagor_civil_status")}${vals.mortgagor_spouse ? ` to ${v(vals, "mortgagor_spouse")}` : ""} with postal address at ${v(vals, "mortgagor_address")} hereinafter known as the MORTGAGOR, and ${v(vals, "mortgagee_name")} of legal age, ${v(vals, "mortgagee_civil_status")}${vals.mortgagee_spouse ? ` to ${v(vals, "mortgagee_spouse")}` : ""} with postal address at ${v(vals, "mortgagee_address")} hereinafter known as the MORTGAGEE, witnesseth:

That the MORTGAGOR is indebted unto the MORTGAGEE in the sum of ${debt.words} (${debt.figures}), Philippine Currency, as evidenced by a Promissory Note dated ${v(vals, "promissory_note_date", "_________________")};

NOW THEREFORE, for and in consideration of the said indebtedness and to secure payment of the principal amount together with interest, the MORTGAGOR hereby CONVEYS and TRANSFERS by way of CHATTEL MORTGAGE unto the MORTGAGEE the following personal property:

MAKE: ${v(vals, "vehicle_make")}
SERIES: ${v(vals, "vehicle_series")}
TYPE: ${v(vals, "vehicle_type")}
MOTOR NO.: ${v(vals, "vehicle_motor_no")}
CHASSIS NO.: ${v(vals, "vehicle_chassis_no")}
PLATE NO.: ${v(vals, "vehicle_plate_no")}

Provided, however, that if the MORTGAGOR shall well and truly pay unto the MORTGAGEE the said indebtedness with interest according to the terms of the Promissory Note, then this mortgage shall become null and void; otherwise it shall remain in full force and effect.

IN WITNESS WHEREOF, the parties have signed this instrument this ${v(vals, "execution_day", "_____")} day of ${v(vals, "execution_month", "________________")}, ${v(vals, "execution_year", "20___")} at ${v(vals, "execution_city", "________________________")}.


_____________________________                  _____________________________
${v(vals, "mortgagor_name", "MORTGAGOR")}                               ${v(vals, "mortgagee_name", "MORTGAGEE")}
MORTGAGOR                                      MORTGAGEE


AFFIDAVIT OF GOOD FAITH

We, the undersigned Mortgagor and Mortgagee, severally swear that the foregoing mortgage is made for the purpose of securing the obligation specified therein, and for no other purpose, and that the same is a just and valid obligation, and one not entered into for the purpose of fraud.


_____________________________                  _____________________________
MORTGAGOR                                      MORTGAGEE


ACKNOWLEDGMENT

REPUBLIC OF THE PHILIPPINES)
${v(vals, "execution_city", "________________________")} ) S.S.

BEFORE ME, a Notary Public in and for ${v(vals, "execution_city", "________________________")}, this ${v(vals, "execution_day", "_____")} day of ${v(vals, "execution_month", "________________")}, ${v(vals, "execution_year", "20___")}, personally appeared the parties who executed the foregoing Chattel Mortgage and took oath to the Affidavit of Good Faith.

                                               NOTARY PUBLIC

Doc. No. ${v(vals, "notary_doc_no", "_______")};
Page No. ${v(vals, "notary_page_no", "_______")};
Book No. ${v(vals, "notary_book_no", "_______")};
Series of ${v(vals, "notary_series", "20___")}.`;
}

// 17. GENERAL AFFIDAVIT
export function generateGeneralAffidavit(vals: TemplateValues): string {
  return `AFFIDAVIT

REPUBLIC OF THE PHILIPPINES)
${v(vals, "execution_city", "________________________")} ) S.S.

I, ${v(vals, "affiant_name", "(Insert Name of Affiant)")}, a ${v(vals, "affiant_citizenship", "Filipino")} citizen, of legal age, ${v(vals, "affiant_civil_status", "single/married")}${vals.affiant_spouse ? ` to ${v(vals, "affiant_spouse")}` : ""}, residing at ${v(vals, "affiant_address", "(Address)")}, after having been duly sworn in accordance with law, hereby depose and state:

1. ${v(vals, "statement_paragraph_1", "That I am the affiant in this sworn statement;")};

2. ${v(vals, "statement_paragraph_2", "That I have personal knowledge of the facts herein stated;")};

3. ${v(vals, "statement_paragraph_3", "That I execute this affidavit to attest to the truth of the foregoing facts and for all legal intents and purposes.")};

${vals.affidavit_purpose ? `This affidavit is executed specifically ${vals.affidavit_purpose}.` : ""}

IN WITNESS WHEREOF, I have hereunto set my hand this ${v(vals, "execution_day", "_____")} day of ${v(vals, "execution_month", "________________")}, ${v(vals, "execution_year", "20___")} in ${v(vals, "execution_city", "________________________")}, Philippines.


_____________________________
${v(vals, "affiant_name", "Affiant")}
(Affiant)


JURAT

SUBSCRIBED AND SWORN to before me this ${v(vals, "execution_day", "_____")} day of ${v(vals, "execution_month", "________________")}, ${v(vals, "execution_year", "20___")} at ${v(vals, "execution_city", "________________________")}, affiant exhibiting to me his/her competent evidence of identity: ${v(vals, "affiant_id_info", "_________________________")}.

                                               NOTARY PUBLIC

Doc. No. ${v(vals, "notary_doc_no", "_______")};
Page No. ${v(vals, "notary_page_no", "_______")};
Book No. ${v(vals, "notary_book_no", "_______")};
Series of ${v(vals, "notary_series", "20___")}.`;
}

// 18. AFFIDAVIT OF LOSS
export function generateAffidavitOfLoss(vals: TemplateValues): string {
  return `AFFIDAVIT OF LOSS

REPUBLIC OF THE PHILIPPINES)
${v(vals, "execution_city", "_____________________________")} ) S.S.

I, ${v(vals, "affiant_name", "(Name of Affiant)")}, Filipino, of legal age, residing at ${v(vals, "affiant_address", "(Address of Affiant)")}, after having been sworn in accordance with law hereby depose and state:

1. That I am the true and lawful owner / custodian of a certain item or document, more particularly described as:
${v(vals, "lost_item_type", "Original Certificate of Registration and Official Receipt")}
${vals.vehicle_description ? `Particulars:
${vals.vehicle_description}
` : ""}
2. That ${v(vals, "loss_date_and_circumstances", "sometime recently, the said document was misplaced and could no longer be found despite diligent search;")};

3. That ${v(vals, "diligent_efforts_taken", "I exerted all diligent efforts to locate the said document but to no avail and it is now deemed lost beyond recovery;")};

4. That the said document has not been confiscated by any law enforcement agency nor pledged or encumbered as collateral for any obligation;

5. That I execute this affidavit ${v(vals, "purpose_of_affidavit", "to attest to the truth of the foregoing facts and to support my application for the issuance of duplicate copies")}.

IN WITNESS WHEREOF, I have hereunto set my hand this ${v(vals, "execution_day", "_____")} day of ${v(vals, "execution_month", "________________")}, ${v(vals, "execution_year", "20___")} at ${v(vals, "execution_city", "________________________")}, Philippines.


_____________________________
${v(vals, "affiant_name", "Affiant")}
Affiant


SUBSCRIBED AND SWORN to before me this ${v(vals, "execution_day", "_____")} day of ${v(vals, "execution_month", "________________")}, ${v(vals, "execution_year", "20___")}, affiant exhibiting his/her ID: ${v(vals, "affiant_id_info", "_________________________")}.

                                               NOTARY PUBLIC

Doc. No. ${v(vals, "notary_doc_no", "________")};
Page No. ${v(vals, "notary_page_no", "________")};
Book No. ${v(vals, "notary_book_no", "________")};
Series of ${v(vals, "notary_series", "20_______")}.`;
}

// 19. AFFIDAVIT OF DESISTANCE
export function generateAffidavitOfDesistance(vals: TemplateValues): string {
  return `AFFIDAVIT OF DESISTANCE

REPUBLIC OF THE PHILIPPINES)
${v(vals, "execution_city", "CITY OF MANILA")} ) S.S.

I, ${v(vals, "complainant_name", "Juan del la Cruz")}, of legal age, ${v(vals, "complainant_civil_status", "single")}, and a resident of ${v(vals, "complainant_address", "# 123 Main St., Malate, Manila")}, after having duly sworn to in accordance with law hereby depose and state:

1. I am the complaining witness for ${v(vals, "nature_of_offense", "Serious Physical Injuries")} against ${v(vals, "accused_name", "Jesus Santos")} in the case entitled "${v(vals, "case_title", "People of the Philippines versus Jesus Santos")}", ${v(vals, "criminal_case_no", "Criminal Case No. 12345")}, ${v(vals, "court_branch", "Metropolitan Trial Court, Branch No. 11, City of Manila")}.

2. ${v(vals, "reasons_for_desistance", "That after a thorough reflection and amicable settlement between the parties, I have realized that the incident arose out of a pure misunderstanding, and the accused has made full amends to my complete satisfaction.")}

3. In view of the foregoing, I have permanently lost interest in the prosecution of this case, and I hereby desist from proceeding against the accused, and respectfully request that this case be dismissed with prejudice.

IN WITNESS WHEREOF, I have hereunto affixed my signature this ${v(vals, "execution_day", "_____")} day of ${v(vals, "execution_month", "________________")}, ${v(vals, "execution_year", "20___")} in ${v(vals, "execution_city", "Manila")}, Philippines.


_____________________________
${v(vals, "complainant_name", "Juan del la Cruz")}
Affiant / Complainant


Conforme:

_____________________________
${v(vals, "public_prosecutor_name", "Romeo Abad")}
Public Prosecutor


SUBSCRIBED AND SWORN to before me this ${v(vals, "execution_day", "_____")} day of ${v(vals, "execution_month", "________________")}, ${v(vals, "execution_year", "20___")} at ${v(vals, "execution_city", "Manila")}, Philippines.

                                               NOTARY PUBLIC

Doc. No. ${v(vals, "notary_doc_no", "_______")};
Page No. ${v(vals, "notary_page_no", "_______")};
Book No. ${v(vals, "notary_book_no", "_______")};
Series of ${v(vals, "notary_series", "20___")}.`;
}

// 20. GENERAL POWER OF ATTORNEY
export function generateGeneralPowerOfAttorney(vals: TemplateValues): string {
  return `GENERAL POWER OF ATTORNEY

KNOW ALL MEN THESE PRESENTS:

I, ${v(vals, "principal_name", "(Name of Principal)")}, of legal age, ${v(vals, "principal_civil_status", "single/married")}${vals.principal_spouse ? ` to ${v(vals, "principal_spouse")}` : ""}, and a resident of ${v(vals, "principal_address", "(Address)")}, do hereby appoint ${v(vals, "agent_name", "(Name of Agent/Attorney-In-Fact)")}, to be my true and lawful attorney, for me and in my name, place, and stead, to do and perform the following acts and things to wit:

1. To administer, manage, and conduct all my business, property, and affairs of whatever nature;
2. To demand, sue for, collect, and receive all debts, sums of money, rents, accounts, and dividends belonging to me;
3. To open, deposit in, draw upon, and operate any bank account in my name in any banking institution;
4. To sign, endorse, execute, and deliver all checks, drafts, contracts, deeds, and releases;
5. To appear and represent me before any government agency, court, or administrative tribunal with full power of substitution.

HEREBY GIVING AND GRANTING unto my said attorney full power and authority to do and perform all and every act necessary to be done in the premises as fully to all intents as I might or could do if personally present.

IN WITNESS WHEREOF, I have hereunto set my hand this ${v(vals, "execution_day", "_____")} day of ${v(vals, "execution_month", "________________")}, ${v(vals, "execution_year", "20___")} at ${v(vals, "execution_city", "________________________")}.


_____________________________                  _____________________________
${v(vals, "principal_name", "Principal")}                               ${v(vals, "agent_name", "Attorney-in-Fact")}
Principal                                      Attorney-in-Fact


SIGNED IN THE PRESENCE OF:

_____________________________                  _____________________________
${v(vals, "witness_1", "Witness 1")}                                ${v(vals, "witness_2", "Witness 2")}


ACKNOWLEDGMENT

REPUBLIC OF THE PHILIPPINES)
${v(vals, "execution_city", "________________________")} ) S.S.

BEFORE ME, a Notary Public in and for ${v(vals, "execution_city", "________________________")}, this ${v(vals, "execution_day", "_____")} day of ${v(vals, "execution_month", "________________")}, ${v(vals, "execution_year", "20___")}, personally appeared ${v(vals, "principal_name")}, exhibiting ID ${v(vals, "principal_id_info", "_________________________")}, known to me to be the person who executed the foregoing General Power of Attorney and acknowledged that the same is his/her voluntary act and deed.

WITNESS MY HAND AND SEAL.

                                               NOTARY PUBLIC

Doc. No. ${v(vals, "notary_doc_no", "______")};
Page No. ${v(vals, "notary_page_no", "______")};
Book No. ${v(vals, "notary_book_no", "______")};
Series of ${v(vals, "notary_series", "20___")}.`;
}

// 21. SPECIAL POWER OF ATTORNEY
export function generateSpecialPowerOfAttorney(vals: TemplateValues): string {
  return `SPECIAL POWER OF ATTORNEY

KNOW ALL MEN BY THESE PRESENTS:

WE, ${v(vals, "principal_name", "(Name of Principal)")}, ${v(vals, "principal_civil_status", "single/married")}${vals.principal_spouse ? ` to ${v(vals, "principal_spouse")}` : ""}, of legal age, with residence and postal address at ${v(vals, "principal_address", "(Address)")} do hereby APPOINT ${v(vals, "agent_name", "(Name of Agent/Attorney-In-Fact)")}, ${v(vals, "agent_civil_status", "single/married")}${vals.agent_spouse ? ` to ${v(vals, "agent_spouse")}` : ""}, likewise of legal age, with postal address at ${v(vals, "agent_address", "(Address)")} as our true and legal representative to act for and in our name and stead and to perform the following acts:

${v(vals, "specific_acts_authorized", "To sell, offer for sale, and come to an agreement as to the purchase price and thereafter to sign for us and in our name the Deed of Absolute Sale over our parcel of land; and to receive the proceeds thereof.")}

HEREBY GIVING AND GRANTING unto our said Attorney-in-Fact full power and authority to do and perform all and every act requisite to carry into effect the foregoing authority, including the power to execute and sign contracts, deeds of conveyance, receipts, and statutory filings before the Bureau of Internal Revenue, Registry of Deeds, and local government units as we might or could lawfully do if personally present, with full power of substitution; and

HEREBY RATIFYING AND CONFIRMING all that our said Attorney-in-Fact or his/her substitute shall lawfully do or cause to be done by virtue of these presents pursuant to Article 1878 of the Civil Code of the Philippines.

IN WITNESS WHEREOF, we have hereunto set our hands this ${v(vals, "execution_day", "_____")} day of ${v(vals, "execution_month", "________________")}, ${v(vals, "execution_year", "20___")} at ${v(vals, "execution_city", "________________________")}.


_____________________________                  _____________________________
${v(vals, "principal_name", "Principal")}                               ${v(vals, "agent_name", "Attorney-in-Fact")}
Principal                                      Attorney-in-Fact


SIGNED IN THE PRESENCE OF:

_____________________________                  _____________________________
${v(vals, "witness_1", "Witness 1")}                                ${v(vals, "witness_2", "Witness 2")}


ACKNOWLEDGMENT

REPUBLIC OF THE PHILIPPINES)
${v(vals, "execution_city", "________________________")} ) S.S.

BEFORE ME, a Notary Public in and for ${v(vals, "execution_city", "________________________")}, this ${v(vals, "execution_day", "_____")} day of ${v(vals, "execution_month", "________________")}, ${v(vals, "execution_year", "20___")}, personally appeared ${v(vals, "principal_name")} with ID ${v(vals, "principal_id_info", "_________________________")}, known to me to be the same person who executed this instrument and acknowledged that the same is his/her free act and deed.

WITNESS MY HAND AND SEAL.

                                               NOTARY PUBLIC

Doc. No. ${v(vals, "notary_doc_no", "______")};
Page No. ${v(vals, "notary_page_no", "______")};
Book No. ${v(vals, "notary_book_no", "______")};
Series of ${v(vals, "notary_series", "20___")}.`;
}

// 22. LAST WILL AND TESTAMENT
export function generateLastWillAndTestament(vals: TemplateValues): string {
  return `LAST WILL AND TESTAMENT

KNOW ALL MEN BY THESE PRESENTS:

I, ${v(vals, "testator_name", "name of testator")}, Filipino citizen, of legal age, ${v(vals, "testator_civil_status", "single/married")}${vals.testator_spouse ? ` to ${v(vals, "testator_spouse")}` : ""}, born on the ${v(vals, "testator_birth_date", "____ of ______________, ____")}, a resident of ${v(vals, "testator_address", "insert address")}, being of sound and disposing mind and memory, and not acting under undue influence or intimidation from anyone, do hereby declare and proclaim this instrument to be my Last Will and Testament, in English, the language which I am well conversant. And I hereby declare that:

I. I desire that should I die, it is my wish to be ${v(vals, "burial_wishes", "buried according to the rites of the Roman Catholic Church")}.

II. I hereby name and appoint ${v(vals, "executor_name", "Name of Executor")} as the sole Executor of this my Last Will and Testament. In the event of his/her incapacity or refusal, I name ${v(vals, "substitute_executor_name", "Substitute Executor")} as substitute Executor.

III. I hereby give, devise, and bequeath all my properties as follows:
A. REAL PROPERTY:
${v(vals, "real_property_bequests", "To my named beneficiaries, the parcel of land in my estate...")}

B. PERSONAL PROPERTY:
${v(vals, "personal_property_bequests", "To my named beneficiaries, all my personal effects and bank accounts...")}

IV. All the rest, residue, and remainder of my estate, whether real or personal, I give and bequeath in equal shares unto my lawful heirs.

IN WITNESS WHEREOF, I have hereunto signed this will consisting of two (2) pages, at the bottom of each page and on the left margin, this ${v(vals, "execution_day", "_____")} day of ${v(vals, "execution_month", "________________")}, ${v(vals, "execution_year", "20__")} in ${v(vals, "execution_city", "________________________")}, Philippines.


_____________________________
${v(vals, "testator_name", "Testator")}
Testator


ATTESTATION CLAUSE

We, the undersigned instrumental witnesses, do hereby certify that the testator, ${v(vals, "testator_name")}, has published and declared unto us this instrument to be his/her Last Will and Testament, and has signed this same on each and every page thereof in our presence, and we, at his/her request and in his/her presence and in the presence of each other, have likewise signed our names as attesting witnesses.


_____________________________                  Residing at: ${v(vals, "witness_1_address", "_________________________")}
${v(vals, "witness_1_name", "Witness 1 Name")}

_____________________________                  Residing at: ${v(vals, "witness_2_address", "_________________________")}
${v(vals, "witness_2_name", "Witness 2 Name")}

_____________________________                  Residing at: ${v(vals, "witness_3_address", "_________________________")}
${v(vals, "witness_3_name", "Witness 3 Name")}


ACKNOWLEDGMENT

REPUBLIC OF THE PHILIPPINES)
${v(vals, "execution_city", "________________________")} ) S.S.

BEFORE ME, a Notary Public in and for ${v(vals, "execution_city", "________________________")}, this ${v(vals, "execution_day", "_____")} day of ${v(vals, "execution_month", "________________")}, ${v(vals, "execution_year", "20__")}, personally appeared the Testator and the three instrumental witnesses above-named, all known to me and to me known to be the same persons who executed this will and attestation.

WITNESS MY HAND AND NOTARIAL SEAL.

                                               NOTARY PUBLIC

Doc. No. ${v(vals, "notary_doc_no", "_____")};
Page No. ${v(vals, "notary_page_no", "_____")};
Book No. ${v(vals, "notary_book_no", "_____")};
Series of ${v(vals, "notary_series", "20__")}.`;
}

// 23. AGREEMENT FOR THE RENOVATION
export function generateAgreementForRenovation(vals: TemplateValues): string {
  const price = vCurr(vals, "contract_price_figures", "contract_price_words");
  return `AGREEMENT FOR THE RENOVATION OF
${v(vals, "project_name", "ABC COFFEE SHOP").toUpperCase()}

KNOW ALL MEN BY THIS PRESENTS:

THAT WE, ${v(vals, "contractor_name", "(Contractor's Name)")}, of legal age, ${v(vals, "contractor_civil_status", "single/married")}, a resident of ${v(vals, "contractor_address", "(Address)")}, hereinafter known as the CONTRACTOR, and ${v(vals, "owner_name", "(Name of Owner)")}, of legal age, ${v(vals, "owner_civil_status", "single/married")}, a resident of ${v(vals, "owner_address", "(Address)")}, hereinafter known as the OWNER, do hereby agree and state:

1. That the CONTRACTOR agrees to finish/renovate ${v(vals, "project_name", "ABC COFFEE SHOP")} located at ${v(vals, "project_location", "(Address)")} at the contract price of ${price.words} (${price.figures}), Philippine Currency.

2. The OWNER shall make an initial downpayment of ${vals.downpayment_figures ? formatPhilippineCurrency(vals.downpayment_figures) : "30%"} upon signing, and progressive milestone billings based on inspected completion.

3. The CONTRACTOR shall commence works on ${v(vals, "commencement_date", "_____________")} and fully complete the renovation within ${v(vals, "completion_days", "Sixty (60) calendar days")}.

4. In the event of unjustified delay, the CONTRACTOR shall pay liquidated damages of ${v(vals, "liquidated_damages_per_day", "PHP 1,000.00")} per calendar day of delay.

5. The CONTRACTOR guarantees all workmanship and structural finishes for a period of ${v(vals, "warranty_period_months", "One (1) Year")} from the date of final acceptance.

IN WITNESS WHEREOF, we have signed this agreement this ${v(vals, "execution_day", "_____")} day of ${v(vals, "execution_month", "________________")}, ${v(vals, "execution_year", "20___")} at ${v(vals, "execution_city", "________________________")}.


_____________________________                  _____________________________
${v(vals, "contractor_name", "CONTRACTOR")}                             ${v(vals, "owner_name", "OWNER")}
CONTRACTOR                                     OWNER


SIGNED IN THE PRESENCE OF:

_____________________________                  _____________________________
${v(vals, "witness_1", "Witness 1")}                                ${v(vals, "witness_2", "Witness 2")}


ACKNOWLEDGMENT

REPUBLIC OF THE PHILIPPINES)
${v(vals, "execution_city", "________________________")} ) S.S.

BEFORE ME, a Notary Public in ${v(vals, "execution_city", "________________________")}, this ${v(vals, "execution_day", "_____")} day of ${v(vals, "execution_month", "________________")}, ${v(vals, "execution_year", "20___")}, personally appeared the CONTRACTOR and OWNER, known to me to be the same persons who executed this agreement.

                                               NOTARY PUBLIC

Doc. No. ${v(vals, "notary_doc_no", "______")};
Page No. ${v(vals, "notary_page_no", "______")};
Book No. ${v(vals, "notary_book_no", "______")};
Series of ${v(vals, "notary_series", "20___")}.`;
}

// 24. MEMORANDUM OF AGREEMENT
export function generateMemorandumOfAgreement(vals: TemplateValues): string {
  return `MEMORANDUM OF AGREEMENT

KNOW ALL MEN BY THESE PRESENTS:

This MEMORANDUM OF AGREEMENT (MOA) is made and entered into this ${v(vals, "execution_day", "[Day]")} day of ${v(vals, "execution_month", "[Month]")}, ${v(vals, "execution_year", "[Year]")}, at ${v(vals, "execution_city", "[City]")}, by and between:

${v(vals, "party_a_name", "[PARTY A NAME]")}, a ${v(vals, "party_a_entity_type", "corporation duly organized under the laws of the Philippines")}, with principal address at ${v(vals, "party_a_address", "[Address]")}, represented herein by its ${v(vals, "party_a_rep_position", "[Position]")}, ${v(vals, "party_a_representative", "[Name of Representative]")}, hereinafter referred to as the FIRST PARTY;

- AND -

${v(vals, "party_b_name", "[PARTY B NAME]")}, a ${v(vals, "party_b_entity_type", "corporation duly organized under the laws of the Philippines")}, with principal address at ${v(vals, "party_b_address", "[Address]")}, represented herein by its ${v(vals, "party_b_rep_position", "[Position]")}, ${v(vals, "party_b_representative", "[Name of Representative]")}, hereinafter referred to as the SECOND PARTY.

WITNESSETH:

${v(vals, "purpose_background_recital", "WHEREAS, the parties desire to collaborate on mutual endeavors and set forth their binding commitments herein;")};

NOW, THEREFORE, the parties agree as follows:

1. OBLIGATIONS OF THE FIRST PARTY:
${v(vals, "party_a_obligations", "The First Party shall provide resources, supervision, and necessary documentation.")}

2. OBLIGATIONS OF THE SECOND PARTY:
${v(vals, "party_b_obligations", "The Second Party shall implement operational activities and coordinate project deliverables.")}

3. TERM: This agreement shall remain in force for a period of ${v(vals, "agreement_term_duration", "One (1) Year")} from execution, unless earlier terminated by thirty (30) days prior written notice.

IN WITNESS WHEREOF, the parties hereto have signed this Memorandum of Agreement on the date and place first written above.


_____________________________                  _____________________________
${v(vals, "party_a_name", "FIRST PARTY")}                                ${v(vals, "party_b_name", "SECOND PARTY")}
First Party                                    Second Party


SIGNED IN THE PRESENCE OF:

_____________________________                  _____________________________
${v(vals, "witness_1", "Witness 1")}                                ${v(vals, "witness_2", "Witness 2")}`;
}

// 25. STUDENT CONSENT AND WAIVER FORM
export function generateStudentConsentAndWaiver(vals: TemplateValues): string {
  return `Republic of the Philippines
EULOGIO “AMANG” RODRIGUEZ
INSTITUTE OF SCIENCE AND TECHNOLOGY
Nagtahan, Sampaloc, Manila

STUDENT AFFAIRS AND SERVICES
PARENT AND STUDENT CONSENT FORM

${v(vals, "event_name", "STUDENT FORUM 2026: United Voices, Shared Purpose: Empowering Sustainable Federated Student Leadership")}
${v(vals, "event_date", "November 13—15, 2026")}
Venue: ${v(vals, "event_venue", "EARIST Nagtahan Campus, Sampaloc, Manila")}

I, ${v(vals, "student_name", "DELA CRUZ, JUAN A.")}, a student of ${v(vals, "student_course_and_year", "BS Information Technology")}, with Student No. ${v(vals, "student_student_no", "_________________________")}, hereby manifest my voluntary participation in the above-stated activity.

PARENT / GUARDIAN CONSENT AND WAIVER

I, ${v(vals, "parent_or_guardian_name", "MARIA DELA CRUZ")}, ${v(vals, "relationship_to_student", "Parent / Guardian")} of the above-named student, residing at ${v(vals, "parent_address", "Manila")}, with Contact No. ${v(vals, "parent_contact_number", "_________________________")}, hereby grant my full consent for my child/ward to participate in the Student Forum 2026.

I acknowledge that the organizers have undertaken all reasonable safety precautions. In case of emergency, the organizers are authorized to contact:
Emergency Contact: ${v(vals, "emergency_contact_person", "_________________________")}
Emergency Phone: ${v(vals, "emergency_contact_number", "_________________________")}

Signed this ${v(vals, "execution_day", "_____")} day of ${v(vals, "execution_month", "________________")}, ${v(vals, "execution_year", "20___")} at ${v(vals, "execution_city", "Manila")}, Philippines.


_____________________________                  _____________________________
Signature of Student                           Signature of Parent / Guardian
${v(vals, "student_name")}                                      ${v(vals, "parent_or_guardian_name")}


SUBSCRIBED AND SWORN to before me this ${v(vals, "execution_day", "_____")} day of ${v(vals, "execution_month", "________________")}, ${v(vals, "execution_year", "20___")}, parent exhibiting ID: ${v(vals, "parent_id_info", "_________________________")}.

                                               NOTARY PUBLIC

Doc. No. ${v(vals, "notary_doc_no", "_______")};
Page No. ${v(vals, "notary_page_no", "_______")};
Book No. ${v(vals, "notary_book_no", "_______")};
Series of ${v(vals, "notary_series", "20___")}.`;
}

// Master Dispatcher
export function generateDocumentText(templateId: string, vals: TemplateValues): string {
  switch (templateId) {
    case "deed_of_absolute_sale":
      return generateDeedOfAbsoluteSale(vals);
    case "template_doas":
      return generateTemplateDOAS(vals);
    case "deed_of_sale_motor_vehicle":
      return generateDeedOfSaleMotorVehicle(vals);
    case "deed_of_donation":
      return generateDeedOfDonation(vals);
    case "deed_of_assignment":
      return generateDeedOfAssignment(vals);
    case "contract_of_lease_template":
      return generateContractOfLeaseTemplate(vals);
    case "lease_contract":
      return generateLeaseContract(vals);
    case "rent_to_own_contract":
      return generateRentToOwnContract(vals);
    case "contract_to_sell":
      return generateContractToSell(vals);
    case "offer_to_purchase":
      return generateOfferToPurchase(vals);
    case "earnest_money_receipt":
      return generateEarnestMoneyReceipt(vals);
    case "exclusive_authority_to_sell":
      return generateAuthorityToSell(vals);
    case "acknowledgement_of_debt":
      return generateAcknowledgementOfDebt(vals);
    case "acknowledgement_receipt":
      return generateAcknowledgementReceipt(vals);
    case "promissory_note":
      return generatePromissoryNote(vals);
    case "chattel_mortgage":
      return generateChattelMortgage(vals);
    case "general_affidavit":
      return generateGeneralAffidavit(vals);
    case "affidavit_of_loss":
      return generateAffidavitOfLoss(vals);
    case "affidavit_of_desistance":
      return generateAffidavitOfDesistance(vals);
    case "general_power_of_attorney":
      return generateGeneralPowerOfAttorney(vals);
    case "special_power_of_attorney":
      return generateSpecialPowerOfAttorney(vals);
    case "last_will_and_testament":
      return generateLastWillAndTestament(vals);
    case "agreement_for_renovation":
      return generateAgreementForRenovation(vals);
    case "memorandum_of_agreement":
      return generateMemorandumOfAgreement(vals);
    case "student_consent_and_waiver":
      return generateStudentConsentAndWaiver(vals);
    default:
      throw new Error(`Unsupported template ID: ${templateId}`);
  }
}

export function getTemplatePreviewSnippet(templateId: string): string {
  try {
    const text = generateDocumentText(templateId, {});
    const lines = text
      .split("\n")
      .map((l) => l.trim())
      .filter(
        (l) =>
          l.length > 0 &&
          !l.startsWith("Doc.") &&
          !l.startsWith("Page") &&
          !l.startsWith("Book") &&
          !l.startsWith("Series")
      );
    return lines.slice(0, 3).join(" - ").slice(0, 150) + "...";
  } catch {
    return "Official statutory Philippine legal instrument format compliant with Supreme Court rules.";
  }
}
