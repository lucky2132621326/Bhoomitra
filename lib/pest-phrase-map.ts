import type { Language } from "@/lib/language-context"
import { translations } from "@/lib/translations"

// Exact-string data for React-rendered pest guidance only. No DOM mutation.
const pestAdviceHindi: Record<string, string> = {
  "Use only the rate printed on a product registered for this crop and pest.": "केवल इस फसल और कीट के लिए पंजीकृत उत्पाद के लेबल पर लिखी मात्रा ही उपयोग करें।",
  "Follow the product label and local agricultural-extension guidance.": "उत्पाद के लेबल और स्थानीय कृषि-विस्तार सलाह का पालन करें।",
  "Wear label-required PPE, avoid drift and water contamination, and never spray while pollinators are active.": "लेबल के अनुसार सुरक्षा उपकरण पहनें, बहाव और जल प्रदूषण से बचें तथा परागण करने वाले कीट सक्रिय हों तो छिड़काव न करें।",

  "Open folded leaves on ten rice hills and count live larvae.": "धान के दस पौध-गुच्छों की मुड़ी पत्तियाँ खोलकर जीवित इल्लियाँ गिनें।",
  "Mark the zone and note how many hills have fresh white scraping.": "क्षेत्र चिन्हित करें और नए सफेद खुरचाव वाले पौध-गुच्छों की संख्या लिखें।",
  "Remove heavily folded leaves in a small nursery or local patch.": "नर्सरी या छोटे प्रभावित हिस्से में बहुत अधिक मुड़ी पत्तियाँ हटाएँ।",
  "Recheck the same marked hills for new folds before escalating control.": "नियंत्रण बढ़ाने से पहले उन्हीं चिन्हित पौधों में नई मुड़ी पत्तियाँ फिर जाँचें।",
  "Avoid excessive nitrogen that produces dense tender growth.": "बहुत अधिक नाइट्रोजन से बचें, क्योंकि इससे घनी कोमल बढ़वार होती है।",
  "Conserve spiders and parasitoids and keep bund weeds managed.": "मकड़ियों और परजीवी लाभकारी कीटों को बचाएँ तथा मेड़ की खरपतवार नियंत्रित रखें।",
  "Use a rice-labelled Bacillus thuringiensis product while larvae are small and exposed.": "इल्लियाँ छोटी और खुली हों तब धान के लिए लेबल वाला बैसिलस थुरिंजिएन्सिस उत्पाद उपयोग करें।",
  "Avoid unnecessary broad-spectrum sprays that kill leaf-roller natural enemies.": "पत्ती मोड़क के प्राकृतिक शत्रुओं को मारने वाले अनावश्यक व्यापक असर के छिड़काव से बचें।",
  "Rice-registered selective leaf-roller larvicide": "धान के लिए पंजीकृत चयनात्मक पत्ती-मोड़क इल्ली नियंत्रण",
  "Treat only confirmed active patches while young larvae are present inside newly folded leaves.": "नई मुड़ी पत्तियों में छोटी जीवित इल्लियाँ मिलने पर केवल पुष्ट सक्रिय हिस्सों का उपचार करें।",
  "Open and recount fresh folded leaves before any repeat treatment.": "दोबारा उपचार से पहले नई मुड़ी पत्तियाँ खोलकर फिर गिनें।",
  "Use only when live-larva and fresh-fold counts cross local rice guidance.": "जीवित इल्लियों और नई मुड़ी पत्तियों की संख्या स्थानीय धान सीमा से अधिक हो तभी उपयोग करें।",

  "Count deadhearts or whiteheads across ten rice hills and split one affected stem to confirm a larva.": "धान के दस पौध-गुच्छों में डेडहार्ट या सफेद बालियाँ गिनें और एक प्रभावित तना चीरकर इल्ली की पुष्टि करें।",
  "Check nearby plants for egg masses and new entry holes.": "आसपास के पौधों में अंडों के गुच्छे और नए प्रवेश छेद जाँचें।",
  "Remove and destroy visible egg masses and badly affected nursery shoots where practical.": "जहाँ संभव हो, दिख रहे अंडों के गुच्छे और बहुत प्रभावित नर्सरी तनों को हटाकर नष्ट करें।",
  "Use pheromone or light-trap observations to time the next field check.": "अगली खेत जाँच का समय फेरोमोन या प्रकाश-जाल के अवलोकन से तय करें।",
  "Clip seedling leaf tips before transplanting where local practice recommends it.": "जहाँ स्थानीय सलाह हो, रोपाई से पहले पौध की पत्ती के सिरे काटें।",
  "Remove rice stubble after harvest and avoid excessive nitrogen.": "कटाई के बाद धान की ठूँठ हटाएँ और अधिक नाइट्रोजन से बचें।",
  "Conserve egg parasitoids and avoid broad-spectrum sprays during natural-enemy activity.": "अंडा परजीवियों को बचाएँ और लाभकारी कीट सक्रिय हों तब व्यापक असर वाले छिड़काव से बचें।",
  "Use locally supplied Trichogramma cards only under extension guidance.": "स्थानीय ट्राइकोग्रामा कार्ड केवल कृषि-विस्तार सलाह के अनुसार उपयोग करें।",
  "Rice-registered stem-borer treatment": "धान के लिए पंजीकृत तना-छेदक उपचार",
  "Apply at the label-approved crop stage when egg hatch or fresh entry is confirmed.": "अंडे फूटने या नया प्रवेश पुष्ट होने पर लेबल में बताए फसल चरण पर ही लगाएँ।",
  "Recount new deadhearts or whiteheads before repeating.": "दोहराने से पहले नए डेडहार्ट या सफेद बालियाँ फिर गिनें।",
  "Act only when current stem checks reach the locally recommended economic threshold.": "तनों की वर्तमान जाँच स्थानीय आर्थिक सीमा तक पहुँचे तभी कार्रवाई करें।",

  "Part the canopy and count hoppers at the base of ten hills in and around the patch.": "पत्तियाँ अलग कर प्रभावित हिस्से और उसके आसपास दस पौध-गुच्छों के आधार पर फुदके गिनें।",
  "Check whether natural enemies such as spiders are present before treatment.": "उपचार से पहले देखें कि मकड़ी जैसे प्राकृतिक शत्रु मौजूद हैं या नहीं।",
  "Drain standing water briefly if agronomically safe and avoid adding nitrogen.": "फसल के लिए सुरक्षित हो तो खड़ा पानी थोड़ी देर निकालें और नाइट्रोजन न डालें।",
  "Recount the same hills to confirm whether the colony is expanding.": "उन्हीं पौध-गुच्छों को फिर गिनकर देखें कि झुंड बढ़ रहा है या नहीं।",
  "Avoid excessive nitrogen and overly dense planting.": "अधिक नाइट्रोजन और बहुत घनी रोपाई से बचें।",
  "Use resistant rice varieties and synchronized planting where locally recommended.": "जहाँ स्थानीय सलाह हो, प्रतिरोधी धान किस्म और एक समय पर रोपाई अपनाएँ।",
  "Conserve spiders, mirid bugs and parasitoids by avoiding prophylactic sprays.": "बिना जरूरत पहले से छिड़काव न करके मकड़ियों, मिरिड कीटों और परजीवियों को बचाएँ।",
  "Spot-treat only active hopperburn edges if lower-impact registered options are available.": "कम प्रभाव वाला पंजीकृत विकल्प हो तो केवल सक्रिय हॉपरबर्न की किनारी का उपचार करें।",
  "Rice-registered selective planthopper product": "धान के लिए पंजीकृत चयनात्मक फुदका नियंत्रण",
  "Direct treatment toward the lower canopy of confirmed active patches without contaminating water channels.": "पुष्ट सक्रिय हिस्से की निचली पत्तियों पर उपचार करें और जल नालियों को दूषित न करें।",
  "Recount hoppers per hill before any repeat application.": "दोबारा लगाने से पहले हर पौध-गुच्छ पर फुदके फिर गिनें।",
  "Use only when base-of-hill counts exceed local stage-specific guidance.": "पौध के आधार की गिनती स्थानीय फसल-चरण सीमा से अधिक हो तभी उपयोग करें।",

  "Tap and inspect the base of ten rice hills for white-backed adults and nymphs.": "धान के दस पौध-गुच्छों के आधार को थपथपाकर सफेद-पीठ वाले वयस्क और शिशु कीट देखें।",
  "Compare nearby healthy and yellowing patches and record hopper counts.": "पास के स्वस्थ और पीले पड़ते हिस्सों की तुलना कर फुदकों की संख्या लिखें।",
  "Avoid nitrogen top-dressing while hopper numbers are being checked.": "फुदकों की गिनती के दौरान ऊपर से नाइट्रोजन न डालें।",
  "Recount the same hills and confirm the species with an agronomist if markings are unclear.": "उन्हीं पौधों को फिर गिनें और पहचान अस्पष्ट हो तो कृषि विशेषज्ञ से प्रजाति पुष्ट कराएँ।",
  "Avoid excessive nitrogen and very dense crop stands.": "अधिक नाइट्रोजन और बहुत घनी फसल से बचें।",
  "Conserve spiders and other hopper predators and manage volunteer rice hosts.": "मकड़ियों व अन्य फुदका-भक्षी जीवों को बचाएँ और अपने आप उगे धान को नियंत्रित करें।",
  "Preserve natural enemies by avoiding early broad-spectrum insecticides.": "शुरुआती व्यापक असर वाले कीटनाशक से बचकर प्राकृतिक शत्रुओं को सुरक्षित रखें।",
  "Use local spot management before considering whole-field treatment.": "पूरे खेत के उपचार से पहले प्रभावित स्थान का सीमित नियंत्रण करें।",
  "Target the lower canopy only in confirmed active patches according to the rice label.": "धान के लेबल के अनुसार केवल पुष्ट सक्रिय हिस्सों की निचली पत्तियों पर उपचार करें।",
  "Repeat base-of-hill counts before another application.": "अगले उपयोग से पहले पौध के आधार पर गिनती दोहराएँ।",
  "Treat only after stage-specific field counts cross local guidance.": "फसल-चरण के अनुसार खेत की गिनती स्थानीय सीमा पार करे तभी उपचार करें।",

  "Sweep or tap ten rice hills and count leafhoppers at several points in the zone.": "क्षेत्र में कई स्थानों पर दस धान पौध-गुच्छों को जाल से या थपथपाकर लीफहॉपर गिनें।",
  "Check for spreading yellowing or virus-like symptoms.": "फैलता पीलापन या वायरस जैसे लक्षण जाँचें।",
  "Remove grassy volunteer hosts near nursery beds where practical.": "जहाँ संभव हो, नर्सरी के पास अपने आप उगे घास जैसे मेजबान हटाएँ।",
  "Repeat sweep counts at the same time of day and compare the marked locations.": "दिन के उसी समय जाल से गिनती दोहराएँ और चिन्हित स्थानों की तुलना करें।",
  "Use healthy seedlings and locally recommended resistant varieties.": "स्वस्थ पौध और स्थानीय रूप से सुझाई प्रतिरोधी किस्में उपयोग करें।",
  "Keep bund weeds managed while preserving beneficial insects.": "लाभकारी कीटों को बचाते हुए मेड़ की खरपतवार नियंत्रित रखें।",
  "Conserve spiders, egg parasitoids and predatory bugs.": "मकड़ियों, अंडा परजीवियों और शिकारी कीटों को बचाएँ।",
  "Avoid broad-spectrum spraying when counts are low and natural enemies are active.": "गिनती कम हो और प्राकृतिक शत्रु सक्रिय हों तो व्यापक असर वाला छिड़काव न करें।",
  "Rice-registered selective leafhopper product": "धान के लिए पंजीकृत चयनात्मक लीफहॉपर नियंत्रण",
  "Treat only confirmed hotspots at the label-approved rice stage.": "लेबल में बताए धान चरण पर केवल पुष्ट प्रभावित स्थानों का उपचार करें।",
  "Repeat standardized sweep or hill counts before another treatment.": "अगले उपचार से पहले तय तरीके से जाल या पौध-गुच्छों की गिनती दोहराएँ।",
  "Use when local counts or confirmed disease-vector risk reach extension guidance.": "स्थानीय गिनती या पुष्ट रोग-वाहक जोखिम कृषि-विस्तार सीमा तक पहुँचे तभी उपयोग करें।",

  "Open the whorl on ten maize plants and check for fresh frass and young larvae.": "मक्का के दस पौधों की भँवर खोलकर ताजा मल और छोटी इल्लियाँ जाँचें।",
  "Record how many plants show new shot holes or deadheart.": "नए छोटे छेद या डेडहार्ट वाले पौधों की संख्या लिखें।",
  "Destroy badly infested whorls or stems in a small local patch where practical.": "जहाँ संभव हो, छोटे प्रभावित हिस्से की बहुत संक्रमित भँवर या तने नष्ट करें।",
  "Recheck newly damaged plants before larvae enter stems.": "इल्लियों के तने में घुसने से पहले नए क्षतिग्रस्त पौधे फिर जाँचें।",
  "Remove infested stalk residues after harvest.": "कटाई के बाद संक्रमित तनों के अवशेष हटाएँ।",
  "Use timely planting and locally recommended tolerant hybrids.": "समय पर बुवाई और स्थानीय रूप से सुझाए सहनशील संकर अपनाएँ।",
  "Use a maize-labelled Bacillus thuringiensis product only while young larvae remain exposed in whorls.": "छोटी इल्लियाँ भँवर में खुली हों तभी मक्का के लिए लेबल वाला बैसिलस थुरिंजिएन्सिस उत्पाद उपयोग करें।",
  "Conserve parasitoids and predators by avoiding unnecessary broad-spectrum sprays.": "अनावश्यक व्यापक असर के छिड़काव से बचकर परजीवी और शिकारी लाभकारी जीवों को बचाएँ।",
  "Maize-registered selective stem-borer larvicide": "मक्का के लिए पंजीकृत चयनात्मक तना-छेदक नियंत्रण",
  "Target active whorls at the label-approved stage before larvae enter the stem.": "इल्लियों के तने में जाने से पहले लेबल-अनुमोदित चरण पर सक्रिय भँवरों को लक्षित करें।",
  "Reinspect for fresh frass and new shot holes before repeating.": "दोहराने से पहले ताजा मल और नए छोटे छेद फिर जाँचें।",
  "Use only when fresh whorl damage and live-larva counts cross local guidance.": "नई भँवर क्षति और जीवित इल्लियों की गिनती स्थानीय सीमा पार करे तभी उपयोग करें।",

  "Check ten plants at dawn or dusk for live larvae, fresh frass and new feeding.": "सुबह या शाम दस पौधों में जीवित इल्लियाँ, ताजा मल और नई खुराक क्षति जाँचें।",
  "Mark the affected rows and separate young larvae from large late-stage caterpillars.": "प्रभावित कतारें चिन्हित करें और छोटी इल्लियों को बड़ी विकसित इल्लियों से अलग पहचानें।",
  "Hand-remove egg masses and larvae in small patches.": "छोटे हिस्सों में अंडों के गुच्छे और इल्लियाँ हाथ से हटाएँ।",
  "Recheck the same rows for fresh feeding and movement into new plants.": "उन्हीं कतारों में नई खुराक क्षति और नए पौधों तक फैलाव फिर जाँचें।",
  "Control grassy volunteer hosts and destroy heavily infested residues.": "अपने आप उगे घास जैसे मेजबान नियंत्रित करें और बहुत संक्रमित अवशेष नष्ट करें।",
  "Use pheromone traps for timing and inspect crop whorls regularly.": "समय तय करने के लिए फेरोमोन जाल उपयोग करें और फसल की भँवर नियमित जाँचें।",
  "Use a crop-labelled Bacillus thuringiensis or approved biological product against small larvae.": "छोटी इल्लियों पर फसल-लेबल वाला बैसिलस थुरिंजिएन्सिस या अनुमोदित जैविक उत्पाद उपयोग करें।",
  "Conserve parasitoids and predators and avoid broad-spectrum sprays when possible.": "परजीवी और शिकारी लाभकारी जीवों को बचाएँ तथा संभव हो तो व्यापक असर के छिड़काव से बचें।",
  "Crop-registered selective armyworm larvicide": "फसल के लिए पंजीकृत चयनात्मक आर्मीवर्म नियंत्रण",
  "Treat confirmed active patches while larvae are small; for maize, reach the whorl only as the label permits.": "इल्लियाँ छोटी हों तब पुष्ट सक्रिय हिस्सों का उपचार करें; मक्का की भँवर में केवल लेबल के अनुसार लगाएँ।",
  "Recount live larvae and fresh feeding before another application.": "अगले उपयोग से पहले जीवित इल्लियाँ और नई खुराक क्षति फिर गिनें।",
  "Use only when crop-specific larval counts or fresh damage cross local guidance.": "फसल के अनुसार इल्ली गिनती या नई क्षति स्थानीय सीमा पार करे तभी उपयोग करें।",

  "Inspect the underside of ten leaves for hairy egg masses and grouped young larvae.": "दस पत्तियों की निचली सतह पर बालदार अंडों के गुच्छे और समूह में छोटी इल्लियाँ जाँचें।",
  "Count damaged plants and look for fresh frass at dusk.": "क्षतिग्रस्त पौधे गिनें और शाम को ताजा मल देखें।",
  "Collect and destroy egg masses and gregarious young larvae.": "अंडों के गुच्छे और समूह में रहने वाली छोटी इल्लियाँ इकट्ठा कर नष्ट करें।",
  "Use pheromone-trap catches to guide another dusk inspection.": "फेरोमोन जाल में पकड़ी संख्या के आधार पर शाम को फिर जाँच करें।",
  "Remove infested weeds and crop residues that shelter larvae.": "इल्लियों को आश्रय देने वाली संक्रमित खरपतवार और फसल अवशेष हटाएँ।",
  "Use clean seedlings and keep regular pheromone-trap and field records.": "स्वस्थ पौध उपयोग करें और फेरोमोन जाल व खेत का नियमित रिकॉर्ड रखें।",
  "Use a crop-labelled Bacillus thuringiensis or approved viral biopesticide against young larvae.": "छोटी इल्लियों पर फसल-लेबल वाला बैसिलस थुरिंजिएन्सिस या अनुमोदित वायरल जैव-कीटनाशक उपयोग करें।",
  "Crop-registered selective tobacco-caterpillar larvicide": "फसल के लिए पंजीकृत चयनात्मक तंबाकू इल्ली नियंत्रण",
  "Spot-treat confirmed active patches at dusk while larvae are young, following the crop label.": "इल्लियाँ छोटी हों तब शाम को फसल लेबल के अनुसार केवल पुष्ट सक्रिय हिस्सों का उपचार करें।",
  "Recheck egg masses, live larvae and fresh feeding before repeating.": "दोहराने से पहले अंडों के गुच्छे, जीवित इल्लियाँ और नई क्षति फिर जाँचें।",
  "Use only when field scouting reaches the crop-specific local action threshold.": "खेत की जाँच फसल के लिए स्थानीय कार्रवाई सीमा तक पहुँचे तभी उपयोग करें।",

  "Count colonies on five tender shoots in the selected zone.": "चुने क्षेत्र में पाँच कोमल शाखाओं पर माहू के झुंड गिनें।",
  "Check for ladybirds, lacewings and parasitised aphid mummies before spraying.": "छिड़काव से पहले लेडीबर्ड, लेसविंग और परजीवीकृत माहू देखें।",
  "Wash small colonies from sturdy plants with water.": "मजबूत पौधों से छोटे माहू झुंड पानी से हटाएँ।",
  "Remove only badly curled, localised shoots and recount tomorrow.": "केवल बहुत मुड़ी स्थानीय शाखाएँ हटाएँ और कल फिर गिनें।",
  "Avoid excessive nitrogen fertiliser.": "अधिक नाइट्रोजन उर्वरक से बचें।",
  "Control weed hosts and inspect new seedlings before transplanting.": "खरपतवार मेजबान नियंत्रित करें और रोपाई से पहले नई पौध जाँचें।",
  "Conserve ladybirds, hoverflies and lacewings.": "लेडीबर्ड, होवरफ्लाई और लेसविंग को बचाएँ।",
  "Use crop-labelled insecticidal soap or neem on small colonies.": "छोटे झुंड पर फसल-लेबल वाला कीटनाशी साबुन या नीम उपयोग करें।",
  "Crop-registered selective aphid product": "फसल के लिए पंजीकृत चयनात्मक माहू नियंत्रण",
  "Target confirmed colonies, especially leaf undersides; avoid whole-field treatment when infestation is local.": "पुष्ट झुंड, खासकर पत्ती की निचली सतह, लक्षित करें; स्थानीय प्रकोप में पूरे खेत का उपचार न करें।",
  "Recount colonies before any repeat treatment.": "दोबारा उपचार से पहले झुंड फिर गिनें।",
  "Spray only when repeat counts rise above the crop-specific threshold and natural enemies are insufficient.": "दोबारा गिनती फसल की सीमा से ऊपर जाए और प्राकृतिक शत्रु पर्याप्त न हों तभी छिड़कें।",

  "Turn over five lower and five upper leaves and count adults and nymphs.": "नीचे की पाँच और ऊपर की पाँच पत्तियाँ पलटकर वयस्क और शिशु सफेद मक्खियाँ गिनें।",
  "Check whether yellowing or virus-like symptoms are spreading beyond the selected zone.": "देखें कि पीलापन या वायरस जैसे लक्षण चुने क्षेत्र से बाहर फैल रहे हैं या नहीं।",
  "Remove only heavily infested leaves from a small patch.": "छोटे हिस्से से केवल बहुत संक्रमित पत्तियाँ हटाएँ।",
  "Place yellow sticky cards for monitoring and repeat leaf counts tomorrow.": "निगरानी के लिए पीले चिपचिपे कार्ड लगाएँ और कल पत्तियों की गिनती दोहराएँ।",
  "Control weed hosts around the crop.": "फसल के आसपास खरपतवार मेजबान नियंत्रित करें।",
  "Avoid excessive nitrogen and inspect seedlings before transplanting.": "अधिक नाइट्रोजन से बचें और रोपाई से पहले पौध जाँचें।",
  "Conserve ladybirds, lacewings and parasitoid wasps.": "लेडीबर्ड, लेसविंग और परजीवी ततैयों को बचाएँ।",
  "Use crop-labelled neem, soap or horticultural oil for an early local infestation.": "शुरुआती स्थानीय प्रकोप में फसल-लेबल वाला नीम, साबुन या बागवानी तेल उपयोग करें।",
  "Crop-registered selective whitefly product": "फसल के लिए पंजीकृत चयनात्मक सफेद मक्खी नियंत्रण",
  "Target leaf undersides in confirmed affected rows; avoid blanket treatment.": "पुष्ट प्रभावित कतारों में पत्ती की निचली सतह लक्षित करें; पूरे खेत का समान उपचार न करें।",
  "Repeat adult and nymph leaf counts before another application.": "अगले उपयोग से पहले पत्तियों पर वयस्क और शिशु कीट फिर गिनें।",
  "Use only when repeated leaf counts rise above local crop guidance or virus risk is confirmed.": "दोहराई पत्ती गिनती स्थानीय फसल सीमा से ऊपर जाए या वायरस जोखिम पुष्ट हो तभी उपयोग करें।",
}

const pestNamesHindi: Record<string, string> = {
  "Rice leaf roller": "धान पत्ती मोड़क",
  "Yellow rice stem borer": "धान का पीला तना छेदक",
  "Brown planthopper": "भूरा फुदका",
  "White-backed planthopper": "सफेद पीठ वाला फुदका",
  "Rice leafhopper": "धान लीफहॉपर",
  "Corn borer": "मक्का तना छेदक",
  "Armyworm": "सैनिक इल्ली",
  "Aphids": "माहू",
  "Greenhouse whitefly": "ग्रीनहाउस सफेद मक्खी",
  "Whitefly": "सफेद मक्खी",
  "Tobacco caterpillar": "तंबाकू की इल्ली",
  "Paddy": "धान", "Rice": "धान", "Maize": "मक्का", "Cotton": "कपास",
  "Groundnut": "मूंगफली", "Soybean": "सोयाबीन", "Tomato": "टमाटर",
  "Chilli": "मिर्च", "Okra": "भिंडी", "Potato": "आलू", "Mustard": "सरसों",
  "Sugarcane": "गन्ना", "Vegetables": "सब्जियाँ", "Grape": "अंगूर",
}

/**
 * Per-language overlays for pest copy. Hindi carries the full agronomic advice
 * set; the other languages currently inherit the shared keyed dictionary and
 * fall back to English for advice strings that have not been translated and
 * agronomist-reviewed yet. See PEST_ADVICE_COVERAGE below.
 */
const pestAdviceByLanguage: Partial<Record<Language, Record<string, string>>> = {
  hi: pestAdviceHindi,
}

const pestNamesByLanguage: Partial<Record<Language, Record<string, string>>> = {
  hi: pestNamesHindi,
}

/** Languages whose pest agronomic advice has been translated. */
export const PEST_ADVICE_COVERAGE: Language[] = ["en", "hi"]

export function getPestPhraseMap(language: Language): Record<string, string> {
  if (language === "en") return {}
  const english = translations.en as Record<string, string>
  const target = translations[language] as Record<string, string> | undefined
  if (!target) return {}
  // Reverse-lookup: English source text -> translated text, from the keyed
  // dictionary, so every language picks up shared UI copy automatically.
  const shared = Object.fromEntries(Object.keys(english).map((key) => [english[key], target[key] ?? english[key]]))
  return { ...shared, ...(pestAdviceByLanguage[language] ?? {}), ...(pestNamesByLanguage[language] ?? {}) }
}
