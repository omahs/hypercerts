import React, { ReactNode } from "react";
import { DataProvider } from "@plasmicapp/loader-nextjs";
import dayjs from "dayjs";
import { Formik, FormikProps } from "formik";
import _ from "lodash";
import html2canvas from "html2canvas";
import { toast } from "react-toastify";
import qs from "qs";
import * as Yup from "yup";
import { DATE_INDEFINITE, DateIndefinite, FormContext } from "./forms";
import { useMintClaim } from "../hooks/mintClaim";
import DappContext from "./dapp-context";
import { formatHypercertData } from "@hypercerts-org/hypercerts-sdk";
import { useMintClaimAllowlist } from "../hooks/mintClaimAllowlist";
import { useRouter } from "next/router";
import { useContractModal } from "./contract-interaction-dialog-context";
import { parseListFromString } from "../lib/parsing";
import { useAccountLowerCase } from "../hooks/account";

/**
 * Constants
 */
const FORM_SELECTOR = "currentForm";
const IMAGE_SELECTOR = "hypercertimage";
export const NAME_MIN_LENGTH = 2;
export const NAME_MAX_LENGTH = 50;

export const DESCRIPTION_MIN_LENGTH = 20;
export const DESCRIPTION_MAX_LENGTH = 1500;

export const DEFAULT_NUM_FRACTIONS = 10000;
export const DEFAULT_HYPERCERT_VERSION = "0.0.1";

//const DEFAULT_TIME = dayjs().format("YYYY-MM-DD");
const DEFAULT_TIME = dayjs();
const DEFAULT_FORM_DATA: HypercertCreateFormData = {
  name: "",
  description: "",
  externalLink: "",
  logoUrl: "",
  //logoImage: null,
  bannerUrl: "",
  //bannerImage: null,
  impactScopes: ["all"] as string[],
  //impactTimeStart: DEFAULT_TIME.format("YYYY-MM-DD"),
  impactTimeEnd: DEFAULT_TIME.format("YYYY-MM-DD"),
  workScopes: "",
  workTimeStart: DEFAULT_TIME.format("YYYY-MM-DD"),
  workTimeEnd: DEFAULT_TIME.format("YYYY-MM-DD"),
  rights: ["Public Display"] as string[],
  contributors: "",
  allowlistUrl: "",
  agreeContributorsConsent: false,
  agreeTermsConditions: false,
  // Hidden
  backgroundColor: "",
  backgroundVectorArt: "",
  metadataProperties: "",
};

interface HypercertCreateFormData {
  name: string;
  description: string;
  externalLink: string;
  logoUrl: string;
  //logoImage: File | null;
  bannerUrl: string;
  //bannerImage: File | null;
  impactScopes: string[];
  //impactTimeStart?: string;
  impactTimeEnd?: string | DateIndefinite;
  workScopes: string;
  workTimeStart?: string;
  workTimeEnd?: string;
  rights: string[];
  contributors: string;
  allowlistUrl: string;
  agreeContributorsConsent: boolean;
  agreeTermsConditions: boolean;
  // Hidden
  backgroundColor: string;
  backgroundVectorArt: string;
  metadataProperties: string;
}

/**
 * Generic utility function to check for valid URLs
 * - We should probably move this to common.ts or util.ts
 * @param value
 * @param opts
 * @returns
 */
const isValidUrl = (
  value: any,
  opts: {
    emptyAllowed?: boolean;
    ipfsAllowed?: boolean;
  },
) => {
  // Check empty, null, or undefined
  if (opts.emptyAllowed && !value) {
    return true;
  } else if (!value) {
    return false;
  }

  // Check IPFS
  const isIpfsUrl = value.match(/^(ipfs):\/\//);
  if (opts.ipfsAllowed && isIpfsUrl) {
    return true;
  }

  try {
    const urlSchema = Yup.string().url();
    urlSchema.validateSync(value);
    return true;
  } catch (e) {
    return false;
  }
};

/**
 * Converts raw form data to a query string
 * @param values
 * @returns
 */
const formDataToQueryString = (values: Record<string, any>) => {
  // We will serialize our Dayjs objects
  const formatDate = (key: string) => {
    if (values[key] === DATE_INDEFINITE) {
      values[key] = DATE_INDEFINITE;
    } else if (values[key] && values[key].format) {
      values[key] = values[key].format("YYYY-MM-DD");
    }
  };
  ["impactTimeStart", "impactTimeEnd", "workTimeStart", "workTimeEnd"].forEach(
    formatDate,
  );
  const filteredValues = _.chain(values)
    .pickBy()
    .omit(["agreeContributorsConsent", "agreeTermsConditions"])
    .value();
  return qs.stringify(filteredValues);
};

/**
 * Converts a query string into raw form data
 * @param query
 * @returns
 */
const queryStringToFormData = (query?: string) => {
  const rawValues = qs.parse(query ?? "");
  const parseValue = (v: any) => {
    return v === DATE_INDEFINITE ? DATE_INDEFINITE : dayjs(v as string);
  };
  const values = {
    ...rawValues,
    // we need to parse dates to match the expected types
    //impactTimeStart: parseValue(rawValues["impactTimeStart"]),
    impactTimeEnd: parseValue(rawValues["impactTimeEnd"]),
    workTimeStart: parseValue(rawValues["workTimeStart"]),
    workTimeEnd: parseValue(rawValues["workTimeEnd"]),
  };
  return values as any;
};

/**
 * Form validation rules
 */
const ValidationSchema = Yup.object().shape({
  name: Yup.string()
    .min(NAME_MIN_LENGTH, `Name must be at least ${NAME_MIN_LENGTH} characters`)
    .max(NAME_MAX_LENGTH, `Name must be at most ${NAME_MAX_LENGTH} characters`)
    .required("Required"),
  description: Yup.string()
    .min(
      DESCRIPTION_MIN_LENGTH,
      `Description must be at least ${DESCRIPTION_MIN_LENGTH} characters`,
    )
    .max(
      DESCRIPTION_MAX_LENGTH,
      `Description must be at most ${DESCRIPTION_MAX_LENGTH} characters`,
    )
    .required("Required"),
  externalLink: Yup.string().test(
    "valid uri",
    "Please enter a valid URL",
    (value) =>
      isValidUrl(value, {
        emptyAllowed: true,
        ipfsAllowed: true,
      }),
  ),
  logoUrl: Yup.string().test("valid uri", "Please enter a valid URL", (value) =>
    isValidUrl(value, {
      emptyAllowed: true,
      ipfsAllowed: false,
    }),
  ),
  bannerUrl: Yup.string().test(
    "valid uri",
    "Please enter a valid URL",
    (value) =>
      isValidUrl(value, {
        emptyAllowed: true,
        ipfsAllowed: false,
      }),
  ),
  impactScopes: Yup.array().min(1, "Please choose at least 1 item"),
  impactTimeEnd: Yup.lazy((val: any) => {
    switch (typeof val) {
      case "string":
        return Yup.string();
      default:
        return Yup.date().when("workTimeStart", (workTimeStart) => {
          return Yup.date().min(
            workTimeStart,
            "End date must be after start date",
          );
        });
    }
  }),
  workScopes: Yup.string()
    .required("Required")
    .min(
      NAME_MIN_LENGTH,
      `Work scopes must be at least ${NAME_MIN_LENGTH} characters`,
    )
    .test("no duplicates", "Please remove duplicate items", (value) => {
      if (!value) {
        return true;
      }
      const items = parseListFromString(value, { lowercase: "all" });
      const dedup = parseListFromString(value, {
        lowercase: "all",
        deduplicate: true,
      });
      return _.isEqual(items, dedup);
    }),
  workTimeEnd: Yup.date().when("workTimeStart", (workTimeStart) => {
    return Yup.date().min(workTimeStart, "End date must be after start date");
  }),
  rights: Yup.array().min(1),
  contributors: Yup.string()
    .required("Required")
    .test("no duplicates", "Please remove duplicate items", (value) => {
      if (!value) {
        return true;
      }
      const items = parseListFromString(value, { lowercase: "all" });
      const dedup = parseListFromString(value, {
        lowercase: "all",
        deduplicate: true,
      });
      return _.isEqual(items, dedup);
    }),
  allowlistUrl: Yup.string().test(
    "valid uri",
    "Please enter a valid URL",
    (value) =>
      isValidUrl(value, {
        emptyAllowed: true,
        ipfsAllowed: false,
      }),
  ),
  agreeContributorsConsent: Yup.boolean().oneOf(
    [true],
    "You must get the consent of contributors before creating",
  ),
  agreeTermsConditions: Yup.boolean().oneOf(
    [true],
    "You must agree to the terms and conditions",
  ),
});

/**
 * Hypercert creation form logic using Formik
 * - For the actual layout of form elements,
 *   we assume it's passed in via the `children` prop.
 * - Use the form elements defined in `./forms.tsx`
 * - Make sure that there is a form element with a `fieldName`
 *   for each field in HypercertCreateFormData
 */
export interface HypercertCreateFormProps {
  className?: string; // Plasmic CSS class
  children?: ReactNode; // Form elements
}

export function HypercertCreateForm(props: HypercertCreateFormProps) {
  // TODO: Wrapped in manually, should be a better way to do this?
  return (
    <DappContext>
      <HypercertCreateFormInner {...props} />
    </DappContext>
  );
}

export function HypercertCreateFormInner(props: HypercertCreateFormProps) {
  const { className, children } = props;
  const { address } = useAccountLowerCase();
  const { push } = useRouter();
  const { hideModal } = useContractModal();

  // Query string
  const [initialQuery, setInitialQuery] = React.useState<string | undefined>(
    undefined,
  );
  // Load the querystring into React state only once on initial page load
  React.useEffect(() => {
    if (!initialQuery) {
      setInitialQuery(window.location.search.replace("?", ""));
    }
  }, [initialQuery]);

  const onComplete = () => {
    hideModal();
    push("/app/dashboard");
  };

  const { write: mintClaim } = useMintClaim({
    onComplete,
  });

  const { write: mintClaimAllowlist } = useMintClaimAllowlist({
    onComplete,
  });

  return (
    <div className={className}>
      <Formik
        validationSchema={ValidationSchema}
        validateOnMount={true}
        validate={(values) => {
          //console.log(values);
          if (typeof initialQuery !== "undefined") {
            // The useEffect has run already, so it's safe to just update the query string directly
            const querystring = formDataToQueryString(values);
            const path = `${window.location.pathname}?${querystring}`;
            window.history.pushState(null, "", path);
          }
        }}
        initialValues={{
          ...DEFAULT_FORM_DATA,
          ...queryStringToFormData(initialQuery),
        }}
        enableReinitialize
        onSubmit={async (values, { setSubmitting }) => {
          if (!address) {
            console.log("User not connected");
            toast("Please connect your wallet", { type: "error" });
            return;
          }

          const image = await exportAsImage(IMAGE_SELECTOR);
          const {
            valid,
            errors,
            data: metaData,
          } = formatValuesToMetaData(
            values,
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            address!,
            image,
          );
          console.log(`Metadata(valid=${valid}): `, metaData);
          if (valid) {
            //return; // Used for testing
            if (values.allowlistUrl) {
              await mintClaimAllowlist({
                metaData,
                allowlistUrl: values.allowlistUrl,
              });
            } else {
              await mintClaim(metaData, DEFAULT_NUM_FRACTIONS);
            }
          } else {
            toast("Error creating hypercert. Please contact the team.", {
              type: "error",
            });
            console.error("SDK formatting errors: ", errors);
          }
          setSubmitting(false);
        }}
      >
        {(formikProps: FormikProps<HypercertCreateFormData>) => (
          <DataProvider
            name={FORM_SELECTOR}
            data={{
              ...formikProps.values,
              isSubmitting: formikProps.isSubmitting,
            }}
          >
            <FormContext.Provider value={formikProps}>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  console.log("Submitting form...");
                  console.log("Form values: ", formikProps.values);
                  console.log("Form errors: ", formikProps.errors);
                  formikProps.handleSubmit();
                }}
              >
                {children}
              </form>
            </FormContext.Provider>
          </DataProvider>
        )}
      </Formik>
    </div>
  );
}

const formatValuesToMetaData = (
  val: HypercertCreateFormData,
  address: string,
  image?: string,
) => {
  // Split contributor names and addresses.
  // - make sure addresses are always lower case
  const contributorNamesAndAddresses = parseListFromString(val.contributors, {
    lowercase: "addresses",
  });
  // Split the work scopes
  const workScopes = parseListFromString(val.workScopes);

  // Mint certificate using contract
  // NOTE: we are fixing the impactTimeStart to be the same as workTimeStart
  const impactTimeframeStart = val.workTimeStart
    ? new Date(val.workTimeStart).getTime() / 1000
    : 0;
  /**
  const impactTimeframeStart = val.impactTimeStart
    ? new Date(val.impactTimeStart).getTime() / 1000
    : 0;
  */
  const impactTimeframeEnd =
    val.impactTimeEnd !== "indefinite" && val.impactTimeEnd !== undefined
      ? new Date(val.impactTimeEnd).getTime() / 1000
      : 0;
  const workTimeframeStart = val.workTimeStart
    ? new Date(val.workTimeStart).getTime() / 1000
    : 0;
  const workTimeframeEnd = val.workTimeEnd
    ? new Date(val.workTimeEnd).getTime() / 1000
    : 0;

  let properties = [];
  if (val.metadataProperties) {
    try {
      properties = JSON.parse(val.metadataProperties);
    } catch (e) {
      console.warn(
        `Unable to parse metadataProperties: ${val.metadataProperties}`,
      );
    }
  }

  return formatHypercertData({
    name: val.name,
    description: val.description,
    external_url: val.externalLink,
    image: image ?? "",
    contributors: contributorNamesAndAddresses,
    workTimeframeStart,
    workTimeframeEnd,
    impactTimeframeStart,
    impactTimeframeEnd,
    workScope: workScopes,
    impactScope: val.impactScopes,
    rights: val.rights,
    version: DEFAULT_HYPERCERT_VERSION,
    properties: properties,
    excludedImpactScope: [],
    excludedRights: [],
    excludedWorkScope: [],
  });
};

const exportAsImage = async (id: string) => {
  const el = document.getElementById(id);
  if (!el) {
    return;
  }
  const canvas = await html2canvas(el, {
    logging: true,
    backgroundColor: null,
    //useCORS: true,
    proxy: "https://cors-proxy.hypercerts.workers.dev/",
    imageTimeout: 0,
  });
  const image = canvas.toDataURL("image/png", 1.0);
  return image;
};
