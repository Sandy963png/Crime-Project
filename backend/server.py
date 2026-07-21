import io
import os
import sys
import base64
import pandas as pd
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from sklearn.ensemble import RandomForestRegressor
from sklearn.preprocessing import LabelEncoder
from math import radians, cos, sin, asin, sqrt
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

app = Flask(__name__)
CORS(app)

# -------------------- EXISTING LOGIC --------------------
# Load dataset
df = pd.read_csv("Crime_dataset_fully_mapped.csv")

specialized_keywords = [
    'Railway','GRP','Cyber','CID','Crime','Anti','Narcotic',
    'Special','Task Force','CICE','SOU','Vigilance','Other Units'
]

df_filtered = df[
    ~df['District'].str.contains('|'.join(specialized_keywords), case=False, na=False)
].copy()

le_state = LabelEncoder()
le_dist = LabelEncoder()

df_filtered['State_Enc'] = le_state.fit_transform(df_filtered['State/UT'].astype(str))
df_filtered['Dist_Enc'] = le_dist.fit_transform(df_filtered['District'].astype(str))

def haversine(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = map(radians,[lat1, lon1, lat2, lon2])
    dlon = lon2 - lon1
    dlat = lat2 - lat1
    a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
    return 2 * asin(sqrt(a)) * 6371

def get_complete_safety_report(current_district_name,
                               is_woman=False,
                               is_child=False,
                               is_sc=False,
                               is_st=False):

    temp_df = df_filtered.copy()

    weights = {
        'woman':0.4 if is_woman else 0,
        'child':0.4 if is_child else 0,
        'sc':0.4 if is_sc else 0,
        'st':0.4 if is_st else 0
    }

    total_persona_weight = sum(weights.values())

    if total_persona_weight > 0:
        n_woman = (weights['woman']/total_persona_weight)*0.80
        n_child = (weights['child']/total_persona_weight)*0.80
        n_sc = (weights['sc']/total_persona_weight)*0.80
        n_st = (weights['st']/total_persona_weight)*0.80

        temp_df['Target_Risk'] = (
            temp_df['crime_against_women'] * n_woman +
            temp_df['crime_against_children'] * n_child +
            temp_df['sc_crime'] * n_sc +
            temp_df['st_crime'] * n_st +
            temp_df['ipc'] * 0.15 +
            temp_df['cyber_crime'] * 0.05
        )

        profile_name = " / ".join([k.upper() for k,v in weights.items() if v>0])

    else:
        temp_df['Target_Risk'] = (
            temp_df['ipc'] * 0.60 +
            temp_df['sll_crime'] * 0.30 +
            temp_df['cyber_crime'] * 0.10
        )
        profile_name = "NORMAL MAN / GENERAL ADULT"

    model = RandomForestRegressor(n_estimators=100, random_state=42)

    model.fit(
        temp_df[['Year','State_Enc','Dist_Enc']],
        temp_df['Target_Risk']
    )

    all_districts = temp_df[
        ['State/UT','District','State_Enc','Dist_Enc','latitude','longitude']
    ].drop_duplicates(subset=['District']).copy()

    all_districts['Year'] = 2024

    raw_preds = model.predict(
        all_districts[['Year','State_Enc','Dist_Enc']]
    )

    log_preds = np.log1p(raw_preds)

    min_l,max_l = log_preds.min(),log_preds.max()

    all_districts['Safety_Index'] = 1 + (log_preds-min_l)*99/(max_l-min_l)

    try:
        current_info = all_districts[
            all_districts['District'].str.lower()==current_district_name.lower()
        ].iloc[0]
    except IndexError:
        print(f"District '{current_district_name}' not found")
        return

    curr_score = current_info['Safety_Index']

    all_districts['Distance_km'] = all_districts.apply(
        lambda r: haversine(
            current_info['latitude'],
            current_info['longitude'],
            r['latitude'],
            r['longitude']
        ),axis=1
    )

    neighbors = all_districts[
        (all_districts['Distance_km']<300) |
        (all_districts['State/UT']==current_info['State/UT'])
    ]

    neighbors = neighbors[
        neighbors['District'].str.lower()!=current_district_name.lower()
    ]

    print("="*70)
    print(f"PERSONALIZED SAFETY REPORT FOR: {current_district_name.upper()}")
    print(f"USER PROFILE: {profile_name}")
    print(f"PREDICTED SAFETY SCORE: {curr_score:.2f}")
    print("(Scale: 1 = Extremely Safe, 100 = High Risk)")
    print("-"*70)

    if curr_score <= neighbors['Safety_Index'].quantile(0.25):
        print("You are already in one of the safest districts.")
    else:
        print("Consider these safer districts:")

        safer_options = neighbors.sort_values('Safety_Index').head(3)

        print(
            safer_options[['District','State/UT','Distance_km','Safety_Index']]
            .to_string(index=False)
        )

    print("="*70)

def top5_safe_women_children():
    temp_df = df_filtered.copy()

    temp_df['Target_Risk'] = (
        temp_df['crime_against_women'] * 0.5 +
        temp_df['crime_against_children'] * 0.4 +
        temp_df['ipc'] * 0.05 +
        temp_df['cyber_crime'] * 0.05
    )

    x = temp_df[['Year','State_Enc','Dist_Enc']]
    y = temp_df['Target_Risk']

    model = RandomForestRegressor(n_estimators=100, random_state=42)
    model.fit(x,y)

    unique_districts = temp_df[['State/UT','District','State_Enc','Dist_Enc']].drop_duplicates()

    unique_districts['Year'] = 2024

    unique_districts['Risk'] = model.predict(
        unique_districts[['Year','State_Enc','Dist_Enc']]
    )

    safest = unique_districts.sort_values("Risk").head(5)

    return safest[['State/UT','District','Risk']].to_dict(orient="records")

# -------------------- EXISTING ROUTES --------------------
@app.route("/safe-cities",methods=["GET"])
def safe_cities():
    result = top5_safe_women_children()
    return jsonify(result)

@app.route("/safety", methods=["POST"])
def safety():
    data = request.json
    district = data.get("district")
    is_woman = data.get("is_woman",False)
    is_child = data.get("is_child",False)
    is_sc = data.get("is_sc",False)
    is_st = data.get("is_st",False)

    buffer = io.StringIO()
    sys.stdout = buffer
    get_complete_safety_report(district,is_woman,is_child,is_sc,is_st)
    sys.stdout = sys.__stdout__
    report = buffer.getvalue()

    return jsonify({"report":report})

# -------------------- NEW FEATURES: GRAPHS AND PDF --------------------

def fig_to_base64(fig):
    buf = io.BytesIO()
    fig.savefig(buf, format="png", bbox_inches='tight')
    plt.close(fig)
    buf.seek(0)
    return base64.b64encode(buf.getvalue()).decode()

def generate_graphs(district):
    temp_df = df_filtered.copy()
    d_df = temp_df[temp_df['District'].str.lower() == district.lower()]
    if d_df.empty:
        return None, None, None

    categories = ['crime_against_women','crime_against_children','sc_crime','st_crime','ipc','cyber_crime']
    values = [d_df[c].sum() for c in categories]

    # PIE CHART
    fig1, ax1 = plt.subplots(figsize=(4,4))
    ax1.pie(values, labels=categories, autopct='%1.1f%%', startangle=90)
    ax1.set_title(f'Crime Distribution in {district}')
    pie_b64 = fig_to_base64(fig1)

    # BAR CHART
    fig2, ax2 = plt.subplots(figsize=(6,4))
    ax2.bar(categories, values, color='skyblue')
    ax2.set_title(f'Crime Category Comparison in {district}')
    ax2.set_ylabel('Number of Crimes')
    bar_b64 = fig_to_base64(fig2)

    # TREND LINE
    fig3, ax3 = plt.subplots(figsize=(6,4))
    for c in categories:
        ax3.plot(d_df['Year'], d_df[c], label=c)
    ax3.set_title(f'Crime Trend in {district} (over Years)')
    ax3.set_xlabel('Year')
    ax3.set_ylabel('Crime Count')
    ax3.legend(fontsize=8)
    trend_b64 = fig_to_base64(fig3)

    return pie_b64, bar_b64, trend_b64

@app.route("/safety-graphs", methods=["POST"])
def safety_graphs():
    data = request.json
    district = data.get("district")
    is_woman = data.get("is_woman", False)
    is_child = data.get("is_child", False)
    is_sc = data.get("is_sc", False)
    is_st = data.get("is_st", False)

    buffer = io.StringIO()
    sys.stdout = buffer
    get_complete_safety_report(district, is_woman, is_child, is_sc, is_st)
    sys.stdout = sys.__stdout__
    report = buffer.getvalue()

    pie, bar, trend = generate_graphs(district)

    return jsonify({
        "report": report,
        "pie_chart": pie,
        "bar_chart": bar,
        "trend_chart": trend
    })

def generate_pdf_report(district, report_text, pie_b64, bar_b64, trend_b64):
    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4
    y = height - 50
    c.setFont("Helvetica-Bold", 18)
    c.drawString(50, y, f"Safety Report: {district}")
    y -= 30
    c.setFont("Helvetica", 12)
    for line in report_text.splitlines():
        c.drawString(50, y, line)
        y -= 20

    def draw_image(b64_img, x, y_pos, w=400, h=200):
        if b64_img:
            img_data = base64.b64decode(b64_img)
            img = ImageReader(io.BytesIO(img_data))
            c.drawImage(img, x, y_pos, width=w, height=h)

    y -= 20
    draw_image(pie_b64, 50, y-200)
    y -= 220
    draw_image(bar_b64, 50, y-200)
    y -= 220
    draw_image(trend_b64, 50, y-200)
    y -= 220

    c.showPage()
    c.save()
    buffer.seek(0)
    return buffer

@app.route("/safety-pdf", methods=["POST"])
def safety_pdf():
    data = request.json
    district = data.get("district")
    is_woman = data.get("is_woman", False)
    is_child = data.get("is_child", False)
    is_sc = data.get("is_sc", False)
    is_st = data.get("is_st", False)

    buffer = io.StringIO()
    sys.stdout = buffer
    get_complete_safety_report(district, is_woman, is_child, is_sc, is_st)
    sys.stdout = sys.__stdout__
    report_text = buffer.getvalue()

    pie, bar, trend = generate_graphs(district)

    pdf_buffer = generate_pdf_report(district, report_text, pie, bar, trend)

    return send_file(
        pdf_buffer,
        as_attachment=True,
        download_name=f"{district}_safety_report.pdf",
        mimetype="application/pdf"
    )

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
